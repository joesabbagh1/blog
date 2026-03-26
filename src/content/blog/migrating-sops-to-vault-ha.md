---
author: Joe Sabbagh
pubDatetime: 2026-03-26
title: "Homelab Security: Migrating from SOPS to High Availability HashiCorp Vault"
featured: true
tags:
  - homelab
  - kubernetes
  - security
  - vault
  - gitops
  - fluxcd
description: Moving away from encrypted Git repositories by deploying a High Availability HashiCorp Vault cluster, and how I pulled off a "SOPS Heist" to recover a lost API token from my Git history.
---

In my [previous homelab posts](https://blog.joesabbagh.com/posts/homelab-upgrade/), I talked extensively about moving from a single laptop to a proper three-node cluster with real networking. But as the cluster grew, so did the number of API keys, database passwords, and webhook tokens I needed to manage.

Until now, my secret management strategy relied entirely on **SOPS and Age**. Everything was encrypted and committed directly into my Git repository alongside my infrastructure manifests. It worked well enough for a while, but it was time to level up to a true enterprise-grade solution.

Here's why I tore down my SOPS setup, how I deployed HashiCorp Vault in High Availability mode, and the story of how I had to execute a "heist" against my own Git history to recover a lost token.

---

## The Old Setup: SOPS and Age

If you use FluxCD or ArgoCD, you are probably familiar with SOPS (Secrets OPerationS). The workflow is straightforward:
1. You generate an Age encryption key.
2. You encrypt your Kubernetes `Secret` YAML files locally.
3. You commit the encrypted files to GitHub.
4. Flux downloads the files, decrypts them using a master key stored in the cluster, and applies them.

### Why move away from it?
While SOPS is fantastic for small projects, it has several friction points:
- **Git History Pollution:** Every time you update a single character in a secret, the entire encrypted payload changes, creating massive, unreadable Git diffs.
- **Rotation Nightmares:** If an encryption key is compromised, you have to manually identify, decrypt, and re-encrypt every single secret file in your repository.
- **No Access Controls:** Anyone who has read access to your repository and the decryption key can read every secret. There's no granular Role-Based Access Control (RBAC).

I wanted a system where my Git repository contained **zero encryption**—only declarative pointers to a secure, centralized vault.

---

## The New Setup: HashiCorp Vault (HA)

To solve these issues, I introduced **HashiCorp Vault**, the industry standard for identity-based secret and encryption management.

### Designing for High Availability (Raft)
Because Vault now holds the literal keys to the kingdom, if Vault goes down, applications can't boot. To simulate a true enterprise environment, I deployed Vault directly into the cluster as a **High Availability (HA)** deployment using Vault's Integrated Storage (Raft).

Instead of relying on an external database like Consul or Postgres, Raft allows the Vault pods to store their own data and stay perfectly synced with each other automatically.
- I deployed **2 replicas** (`vault-0` and `vault-1`).
- I used standard Kubernetes `NodeAffinity` rules to explicitly prevent the databases from scheduling on my control plane node.
- I configured Shamir's Secret Sharing to require 3 out of 5 human keys to unseal the database if the cluster ever completely reboots.

### Bridging Vault to Kubernetes: External Secrets Operator
Applications in Kubernetes expect standard `Secret` objects. They don't know how to speak the HashiCorp Vault API.

To bridge this gap natively, I deployed the **External Secrets Operator (ESO)**. ESO acts as a middleman:
1. It securely authenticates to the Vault cluster.
2. You define an `ExternalSecret` custom resource (which looks just like a normal Kubernetes file, but only contains the names of the keys, not the passwords).
3. ESO automatically reaches into Vault, pulls the raw passwords, and creates standard Kubernetes `Secrets` for your applications to consume.

If a password rotates in Vault, ESO automatically detects the change within 60 seconds and instantly updates the Kubernetes Secret.

---

## The Incident: The SOPS "Heist"

Migrations never go perfectly.

After successfully migrating my apps to utilize Vault, I went through the repository and thoroughly purged all the old `.sops.yaml` files and my local `age.agekey` to enforce the new system. 

About ten minutes later, I realized I had accidentally overridden a critical gateway token for one of my AI applications (`openclaw`) with a placeholder string during the Vault insertion process. Because I wiped my local Age key and the local SOPS files, the original token was seemingly gone forever.

I essentially locked myself out of my own application. However, I realized the old data was just buried in the Git history, encrypted by a key I supposedly threw away.

### Executing the Recovery
Here is exactly how I broke back into my own encrypted history:

**1. Finding the Payload**
First, I searched the `git log` to find the exact commit made right before I deleted the SOPS files. Using `git show`, I extracted the legacy, encrypted `secret.yaml` file to a temporary folder `/tmp/old_sops.yaml` without altering my current Git tree.

```bash
git log -n 5 --oneline apps/base/openclaw/secret.yaml
git show <commit-hash>:apps/base/openclaw/secret.yaml > /tmp/old_sops.yaml
```

**2. Hunting for the Master Key**
I had deleted my *local* `age.agekey`, but I remembered how Flux works: for Flux to have functioned yesterday, it required a copy of that master key to live inside the cluster's `flux-system` namespace. Since I hadn't explicitly deleted the Kubernetes namespace resources yet, the master key was still sitting there.

```bash
kubectl get secret sops-age -n flux-system -o jsonpath='{.data.age\.agekey}' | base64 -d > /tmp/age.agekey
```

**3. The Decryption**
With the historical encrypted payload and the active master key securely piped to my terminal, I passed them both back into the `sops` CLI:
```bash
SOPS_AGE_KEY_FILE=/tmp/age.agekey sops -d /tmp/old_sops.yaml
```
The terminal instantly spit out the raw, unencrypted Kubernetes YAML, allowing me to copy the lost API token and inject it straight into the new Vault cluster.

---

## Enterprise Implications & Risks

This "heist" was a fun homelab rescue, but it highlights a massive, often-ignored security risk in enterprise environments.

When companies migrate away from legacy encryption systems (like SOPS or old AWS KMS keys) to a centralized Vault, they often focus solely on the *new* system. They delete the old encrypted files from the `main` branch and call the migration complete.

**The Risk:** 
As I demonstrated, Git never forgets. Your old encrypted secret files live forever in your commit history. The immediate danger here isn't necessarily that the old passwords exist in Git, but rather that the *legacy decryption keys* were left actively sitting inside the Kubernetes cluster.

If an infrastructure engineer completes a migration to Vault but forgets to completely delete the old `sops-age` master keys from the cluster, they leave a backdoor wide open. Any malicious actor who gains basic read-access to the Git repository and the cluster can effortlessly travel back in time, extract the old payloads, and decrypt them using that forgotten key.

When you migrate secret management systems, you **must** diligently track down and destroy every single token and credential tied to the old system's infrastructure. Because if you can execute a heist against your own Git history using a leftover key, so can an attacker.

---

## Wrap Up

Moving away from SOPS and local Age keys to Vault feels like a much more solid foundation for the cluster.

The combination of Vault and the External Secrets Operator takes the local encryption overhead out of the equation. Now, I just drop a pointer in Git, put the actual token into Vault, and let Kubernetes handle the rest. It's clean, declarative, and keeps the Git history completely free of encrypted blobs.