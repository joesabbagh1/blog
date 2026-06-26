---
author: Joe Sabbagh
pubDatetime: 2026-06-26
title: "k8s-soar: Building an Enterprise-Grade Kubernetes SOAR Fortress"
featured: true
tags:
  - kubernetes
  - security
  - SOAR
  - falco
  - tetragon
  - kyverno
  - eBPF
description: For my Master's Thesis, I built k8s-soar, a comprehensive Security Orchestration, Automation, and Response (SOAR) architecture for Kubernetes leveraging eBPF, Shuffle, and bidirectional observability.
---

<base target="_blank">

For my Master's Thesis, I set out to solve a fundamental problem in cloud-native security: **if an attacker breaches a Kubernetes cluster, how does the infrastructure respond?**

Most organizations deploy security tools in isolation. They might install Falco for detection, Kyverno for policy enforcement, and Prometheus for monitoring. However, these tools rarely communicate. When a critical security event occurs, it often generates an alert in a dashboard, waiting for a human operator to notice, investigate, and manually intervene. In the world of automated cloud infrastructure, human reaction time is too slow to stop lateral movement or data exfiltration.

To bridge this gap, I designed and developed **k8s-soar**, a complete Kubernetes Security Orchestration, Automation, and Response (SOAR) architecture. It wires together best-in-class security tools using eBPF, deeply integrates them with an enterprise-grade observability stack, and closes the loop with automated, active incident response.

The project is split across two repositories:

- [**k8s-soar**](https://github.com/joesabbagh1/k8s-soar): The core infrastructure, bringing together the detection, enforcement, and orchestration engines into a unified deployment.
- [**k8s-soar-scenarios**](https://github.com/joesabbagh1/k8s-soar-scenarios): A dedicated Threat Simulation and Validation framework used to continuously pressure-test the architecture against complex attack vectors.

---

## The Security Architecture: Defense in Depth

The architecture is built on a "Defense in Depth" model, recognizing that there is no single silver bullet in cybersecurity. Security must be enforced at every layer: at the admission controller, at the network boundary, and deep within the Linux kernel.

### Prevention: Kyverno

Before a workload even starts, **Kyverno** acts as the gatekeeper. It applies policy-as-code at the Kubernetes admission layer. Kyverno validates incoming manifests to ensure that no privileged containers are launched, sensitive hostPath mounts are blocked, and images are cryptographically signed. If an attacker compromises a CI/CD pipeline and attempts to deploy a malicious pod, Kyverno blocks the deployment before it ever reaches a node.

### Detection: Falco

Once workloads are running, **Falco** acts as the cluster's surveillance camera. Utilizing modern eBPF probes, it monitors system calls in real-time. Falco does not block traffic. Instead, it provides high-fidelity, asynchronous detection of suspicious activities like unexpected binary execution, sensitive file reads, or abnormal namespace transitions. When a rule is triggered, Falco generates a detailed JSON alert containing full Kubernetes metadata.

### Enforcement: Tetragon

While Falco observes, **Tetragon** enforces. Built heavily on eBPF, Tetragon operates synchronously within the kernel datapath. This means Tetragon can evaluate an action and apply a `SIGKILL` to a malicious process before the action completes in user space. Whether an attacker tries to overwrite `/etc/shadow` or establish a covert network connection, Tetragon's TracingPolicies can instantly sever the process at the kernel level, acting as a highly precise scalpel.

### Networking: Cilium

**Cilium** provides the underlying eBPF-based container networking. Beyond its performance benefits, Cilium enables deep L3-L7 network policies. In the context of k8s-soar, Cilium is the muscle behind our network quarantines, enforcing default-deny postures and instantly isolating compromised endpoints without disrupting the rest of the cluster.

---

## The SOAR Engine: Shuffle & Bidirectional Observability

The true innovation of the architecture lies in the "R" (Response). Rather than relying on simple, hardcoded scripts that break at scale, the system is powered by **Shuffle**, an open-source, enterprise-grade SOAR platform. Shuffle acts as the "brain," evaluating complex, multi-stage attacks and executing generalized automated response workflows.

### Dynamic Automated Workflows

Shuffle does not rely on a single, rigid response path; instead, it dynamically adapts its workflow based on the type of threat detected. Playbooks are designed to map specific attack scenarios to appropriate, proportionate responses ranging from simple alerting to aggressive cluster-wide cordoning.

As an example, when a sophisticated **Reverse Shell (T1059 / T1090)** scenario unfolds, the system executes the following comprehensive workflow:

1. **Triggering the Playbook:** Falco detects the anomalous shell activity and sends the JSON payload to `falcosidekick`, which immediately POSTs the alert to a Shuffle Webhook.
2. **Deep Enrichment:** Shuffle doesn't just blindly kill the pod. It begins building a forensic context. It queries **Loki** to extract the last 15 minutes of application logs from the compromised pod, queries **Prometheus** for resource spikes, and pulls execution traces from **Tetragon** to understand what the attacker touched before the alert fired.
3. **Forensic Reporting:** Shuffle compiles this enriched data into a comprehensive forensic report (detailing the MITRE ATT&CK vectors, the associated IP addresses checked against Threat Intelligence APIs, and the application logs). This report is automatically sent to the SOC team via Slack and attached to a newly created incident ticket (e.g., Jira or TheHive).
4. **Active Response:** Concurrently, Shuffle makes an API call to the Kubernetes control plane to patch the compromised pod with a quarantine label.
5. **Isolation:** Cilium instantly recognizes the label and drops all ingress and egress traffic for that pod, containing the blast radius while keeping the pod alive for further memory forensics.

While the Reverse Shell scenario triggers network isolation and full forensic reporting, other scenarios dictate entirely different playbooks. For instance, a crypto-miner detection might trigger an immediate process termination without a full network quarantine, whereas a lateral movement attempt might result in cordoning the entire node and draining its workloads to protect the control plane.

### Complete Traceability

Traceability in k8s-soar is designed for enterprise compliance. It is not just a log entry. When Shuffle orchestrates a response, it updates the incident ticket with the exact actions taken and pushes rich Annotations directly to the **Grafana** API. When SOC analysts view their dashboards, they see a vertical timeline marker indicating exactly when the breach occurred, when the forensic data was captured, and when the automated isolation took effect.

---

## Threat Modeling and Continuous Validation

A security stack is only as reliable as its last test. To ensure the architecture can withstand real-world threats, I am continuously adding and refining complex attack scenarios mapped to the [MITRE ATT&CK for Containers](https://attack.mitre.org/matrices/enterprise/containers/) framework.

Examples of these scenarios include:

- **T1611 Escape to Host:** Exploiting overly permissive configurations to break out of the container namespace and access the underlying node.
- **T1059 Execution / T1090 Proxy:** Establishing multi-stage reverse shells to exfiltrate data.
- **T1496 Resource Hijacking:** Stealthy execution of crypto-miners disguised as legitimate background processes.

### The CI/CD Validation Pipeline

To guarantee that new policies, rule updates, or infrastructure changes do not degrade our security posture, the [**k8s-soar-scenarios**](https://github.com/joesabbagh1/k8s-soar-scenarios) repository serves as an automated validation framework.

This is where my **Homelab** comes into play as a continuous execution environment. The scenarios repository features a GitHub Actions CI/CD pipeline (which is currently a work in progress). The goal is that every time a new scenario is added or an existing one is edited, the pipeline will connect to the physical homelab cluster and systematically detonate the attack scenarios.

The pipeline acts as an automated red team, verifying the entire defense chain: Did Kyverno attempt to block it? Did Falco and Tetragon detect the runtime anomalies? Did Shuffle generate the forensic report and successfully isolate the threat?

If any stage of the Defense in Depth model fails to react correctly, the CI/CD pipeline turns red, ensuring that the architecture's Active Response capabilities are rigorously tested and verified against real infrastructure, every single time.

---

## Conclusion

Building **k8s-soar** for my Master's Thesis demonstrated the value of evolving Kubernetes security beyond passive visibility. While dashboards and alerts remain essential for situational awareness, pairing them with automated orchestration allows the infrastructure to defend itself at machine speed, significantly reducing the window of exposure during a breach.

By unifying the preventative power of Kyverno, the deep kernel enforcement of eBPF via Falco and Tetragon, and the intelligent, automated orchestration of Shuffle, we can create a highly resilient, self-healing Kubernetes fortress. It doesn't just detect threats—it enriches, reports, and isolates them, transforming the cluster from a passive victim into an active defender.
