---
author: Joe Sabbagh
pubDatetime: 2026-06-15
title: "k8s-soar: Building a Detect-and-Respond Security Stack for My Homelab Cluster"
featured: true
tags:
  - homelab
  - kubernetes
  - security
  - falco
  - tetragon
  - kyverno
  - cilium
  - eBPF
description: How I built k8s-soar, a layered Kubernetes security stack with Falco, Tetragon, Kyverno, and an automated quarantine responder, and how I plan to deploy it on my three-node homelab cluster.
---

<base target="_blank">

In my [previous homelab posts](https://blog.joesabbagh.com/posts/homelab-upgrade/), I focused on getting a real three-node cluster running: Cilium networking, Traefik ingress, Flux GitOps, Vault for secrets, and a pile of self-hosted apps. I also had a proper observability stack — Grafana with Prometheus for metrics and Loki for logs. The infrastructure side was solid. The security side was not.

I had TLS, a subnet router, and a secrets vault, but nothing watching for suspicious behaviour inside my pods. Prometheus could tell me a pod was up; Loki gave me application logs when I went looking. Neither would catch a reverse shell or an unexpected outbound connection. No runtime detection. No admission policies. No automated response when something looked wrong. If a compromised container started spawning shells or phoning home, I would only find out if I happened to be staring at a Grafana dashboard at the right moment.

That gap is what **k8s-soar** is built to close. The name stands for **Kubernetes Security Orchestration, Automation & Response**. It is an open-source project I built to provision a complete detect-and-respond security stack on bare-metal Kubernetes, and the plan is to bring it onto my production homelab cluster next.

All the code lives in the [k8s-soar repo](https://github.com/joesabbagh1/k8s-soar) on GitHub.

---

## The Problem: Security Tools in Isolation

Most Kubernetes security guides treat each tool as a standalone install. Install Falco here. Add Kyverno there. Maybe throw in a NetworkPolicy or two. What you end up with is a collection of components that do not talk to each other.

That is fine for ticking boxes on a compliance checklist. It is not fine when you actually want to know whether detection triggers a meaningful response.

I wanted to answer a specific question: **if an attacker gets a shell inside a container, what happens next?** Not in theory, but in my cluster, with real alerts, real policies, and real isolation.

k8s-soar is the answer to that question. It wires together four security layers into a single install path, validates them against eight MITRE ATT&CK–mapped attack scenarios, and closes the loop with an automated **Detect → Isolate** workflow.

---

## What I Built

k8s-soar is a Helm umbrella chart plus Ansible bootstrap that installs a full security stack from scratch on bare-metal Linux. The stack has four distinct phases:

| Phase | Component | What it does |
| ----- | --------- | ------------ |
| **Prevent** | Kyverno | Blocks bad pods at admission time: privileged containers, hostPath mounts, `:latest` tags |
| **Detect** | Falco | Watches syscalls via modern eBPF and fires alerts on suspicious runtime behaviour |
| **Enforce** | Tetragon | Applies kernel-level TracingPolicies that can kill processes or log network connections |
| **Respond** | SOAR responder | Receives Falco alerts via webhook and quarantines the offending pod |

Under the hood, the stack also includes **Cilium** as the eBPF CNI (with Hubble for flow observability) and a dedicated **`security-lab`** namespace where attack scenarios run in isolation from everything else.

### The SOAR Workflow

The "R" in SOAR is not a Splunk integration or a PagerDuty runbook. It is a lightweight Python webhook responder running inside the cluster. The flow looks like this:

```text
Falco detects suspicious activity
        │
        ▼
falcosidekick receives the JSON alert
        │
        ▼
POST to k8s-soar-responder:8080/webhook
        │
        ▼
Responder patches the pod with label security.quarantine=true
        │
        ▼
CiliumNetworkPolicy denies all ingress and egress
```

The entire loop, from syscall to network isolation, completes in seconds. No human in the loop required.

The responder itself is roughly 130 lines of Python. It parses Falco alert metadata to identify the namespace and pod name, patches the pod label, and lets Cilium's quarantine policy do the rest. Simple, auditable, and entirely in-cluster.

### Custom Detection Rules

Falco ships with a solid default ruleset, but I wrote custom rules scoped to the `security-lab` namespace to keep noise down on a real cluster. The four custom rules cover:

- **Shell spawned inside a container**: detects `bash`/`sh` execution in the lab victim pod
- **Sensitive credential access**: reads of service account tokens or `/etc/shadow`
- **Reverse shell outbound**: outbound connections combined with shell processes
- **Crypto miner processes**: matches known miner binaries like `xmrig` and `minerd`

Kyverno policies and Tetragon TracingPolicies follow the same pattern: scoped, named, and mapped to specific attack scenarios.

---

## What It Defends Against

Every scenario in k8s-soar is mapped to the [MITRE ATT&CK for Containers](https://attack.mitre.org/matrices/enterprise/containers/) framework. There are eight core scenarios:

| Scenario | Threat | MITRE Technique | Primary Defense |
| -------- | ------ | --------------- | --------------- |
| Shell in container | Attacker execs into a running pod | T1059 Execution | Falco detect → SOAR isolate |
| Privileged pod / hostPath | Container escape to host | T1611 Escape to Host | Kyverno block at admission |
| SA token theft | Reading mounted service account credentials | T1552 Credential Access | Kyverno audit + Falco detect |
| Reverse shell | Outbound callback to attacker C2 | T1059 Execution | Falco detect + Tetragon observe |
| Crypto miner | Resource hijacking for cryptocurrency | T1496 Resource Hijacking | Falco detect → SOAR isolate |
| Missing security context | Pods running as root with `:latest` tags | Best practice | Kyverno audit |
| Lateral movement | Pod-to-pod communication inside the cluster | T1021 Lateral Movement | Default-deny NetworkPolicy + Hubble |
| Sensitive host path write | Writing to `/etc/shadow` or `/root/` | T1611 Escape to Host | Kyverno block + Tetragon Sigkill |

Each scenario has a runbook (`scenarios/NN-name/run.sh`) and expected evidence documented in a README. You trigger the attack manually, then verify that the right tool fired at the right layer.

This is deliberately lab-first. The `security-lab` namespace runs a minimal victim workload behind default-deny network policies. Attack simulations never touch your real apps.

---

## How It Will Be Applied on My Cluster

My homelab cluster already runs several pieces of this stack. The [homelab repo](https://github.com/joesabbagh1/homelab) manages everything through Flux GitOps on three HP EliteDesk nodes at `192.168.0.10`–`.12`. Cilium 1.19 is already the CNI. Grafana, Prometheus, and Loki live in the `monitoring` namespace. Vault HA handles secrets via External Secrets Operator.

What is missing is everything above the network layer: no Falco, no Tetragon, no Kyverno, no SOAR responder, no runtime visibility at all.

The deployment plan breaks into four phases.

### Phase 1: Add the Security Stack via Flux

Since Cilium is already running, the k8s-soar Helm install skips the CNI and deploys only the security components:

- **Falco** + falcosidekick in the `falco` namespace
- **Tetragon** TracingPolicies in `kube-system`
- **Kyverno** admission policies in the `kyverno` namespace
- **SOAR responder** in the `k8s-soar` namespace

This means adding HelmRepository CRs for `falcosecurity` and `kyverno` to my Flux infrastructure layer, then creating HelmRelease manifests under `apps/base/`, the same pattern I already use for Vault, Traefik, and the media stack.

Kyverno policies will ship in **Audit** mode first. I want to collect a baseline of what would have been blocked before flipping anything to Enforce. Blocking Jellyfin because it uses a `:latest` tag is not the goal.

### Phase 2: Deploy the Security Lab

The `security-lab` namespace gets its own Flux kustomization, sourced from the k8s-soar repo. It includes:

- A minimal victim deployment (`busybox:1.36`, non-root, dropped capabilities)
- Default-deny CiliumNetworkPolicies with explicit DNS egress only
- The quarantine CNP that triggers when a pod gets labeled `security.quarantine=true`

Falco custom rules are scoped exclusively to `security-lab`. Running attack scenarios against the lab will not generate alerts from my production workloads.

### Phase 3: Wire Up the SOAR Pipeline

falcosidekick is configured to POST alerts at WARNING priority or above to the in-cluster responder:

```yaml
# values.yaml (k8s-soar)
falcosidekick:
  config:
    webhook:
      address: "http://k8s-soar-responder.k8s-soar.svc.cluster.local:8080/webhook"
      minimumpriority: "warning"
```

When a scenario triggers a Falco alert, the responder labels the pod and Cilium cuts its network access. No external orchestrator required, though I may later route alerts to Grafana dashboards and use Vault for webhook credentials.

### Phase 4: Validate with Attack Scenarios

Once the stack is live, I run the eight scenario scripts one at a time against `security-lab`:

```bash
./scenarios/01-shell-in-container/run.sh
./scenarios/04-reverse-shell/run.sh
# ... see scenarios/threat-matrix.md
```

Each run produces evidence I can capture with `scripts/capture-scenario-evidence.sh`: Falco alert logs, falcosidekick delivery confirmation, responder patch events, and the quarantine label on the target pod.

Pass/fail against the threat matrix becomes the proof that the stack actually works, not just that it installed cleanly.

---

## How This Improves Cluster Security

Before k8s-soar, my homelab security posture looked like this:

- **Network boundary**: Tailscale subnet router, no public exposure, private DNS
- **Secrets**: Vault HA with External Secrets Operator, no encrypted blobs in Git
- **TLS**: cert-manager with Cloudflare DNS-01
- **Runtime**: nothing

That last line is the gap. A cluster can have perfect secrets management and locked-down ingress and still be wide open internally. A compromised pod could spawn shells, read mounted credentials, mine cryptocurrency, or pivot to other pods, and nothing would notice.

k8s-soar adds four concrete improvements:

**1. Prevention at the gate.** Kyverno blocks privileged containers, hostPath volumes, and root pods before they ever schedule. Bad configurations fail at admission, not after they are running.

**2. Runtime visibility.** Falco watches every syscall in every container via eBPF. Shells, credential reads, outbound reverse shells, and miner processes all generate structured JSON alerts with Kubernetes metadata attached.

**3. Kernel-level enforcement.** Tetragon goes further than detection. It can Sigkill a process that tries to write to `/etc/shadow` or log outbound TCP connections from suspicious processes. Detection and enforcement are separate layers on purpose.

**4. Automated containment.** The SOAR responder closes the loop. Detection without response is just logging. Labeling a pod `security.quarantine=true` and letting Cilium deny all traffic means a compromised workload is contained in seconds, without waiting for me to notice an alert in Grafana.

Together, these layers turn the cluster from "secure at the perimeter" into "secure in depth", with a validated, reproducible threat matrix to prove it.

---

## What Comes Next

The k8s-soar repo is installable today on a fresh bare-metal cluster via a single `./ansible/setup.sh` command. The homelab integration (Flux HelmReleases, security-lab namespace, scenario validation on production hardware) is the next step.

After baseline validation in Audit mode, the plan is to:

1. Flip Kyverno policies to Enforce for cluster-wide hardening
2. Extend quarantine CNPs beyond `security-lab` to cover production namespaces
3. Route Falco alerts to Grafana dashboards for ongoing visibility
4. Document results in the thesis threat matrix with captured evidence per scenario

If you run a homelab or a small bare-metal Kubernetes cluster and want to go beyond "I installed Falco once", the full stack is wired together with attack scenarios to prove it works. The repo is open and the install path is documented.

---

## Wrap Up

Building k8s-soar started as a thesis project and turned into something I actually want running on my cluster. The stack is not exotic. Cilium, Falco, Tetragon, and Kyverno are all well-known tools. What is different is wiring them together into a single install, validating them against real attack scenarios, and closing the loop with automated quarantine.

My homelab already has the networking and secrets foundation. k8s-soar adds the runtime security layer on top. Prevent bad pods. Detect suspicious behaviour. Enforce at the kernel. Respond automatically.

That is the stack I wanted. Now it is time to deploy it.
