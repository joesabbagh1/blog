---
author: Joe Sabbagh
pubDatetime: 2026-02-22
title: "Homelab 2.0: From One Laptop to a Real Cluster"
featured: true
tags:
  - homelab
  - kubernetes
  - ansible
  - networking
  - cilium
  - traefik
  - pihole
  - tailscale
description: How I went from a single laptop running Kubernetes to a three-node cluster with real networking, local TLS, and remote access via Tailscale.
---

<base target="_blank">

It's been a while since my [first homelab post](https://blog.joesabbagh.com/posts/homelab-setup/). Back then I was running a single HP notebook as a one-node Kubernetes cluster, exposing apps through Cloudflare Tunnels, and calling it a day.

This time I went bigger. Three physical nodes, a managed switch, real networking, proper TLS certificates, a local DNS resolver, and remote access through Tailscale. No Cloudflare Tunnels, no public exposure. Everything is private and local, the way a homelab should be.

All the config lives in my [homelab repo](https://github.com/joesabbagh1/homelab) on GitHub.

Here's how it all fits together.

---

## Hardware

### Compute Nodes

The old single laptop is gone. The cluster now runs on three mini-PCs:

- **Model:** HP EliteDesk 705 G3 (×3)
- **Node 1:** `192.168.0.10`
- **Node 2:** `192.168.0.11`
- **Node 3:** `192.168.0.12`

Three identical machines make for a clean setup, same hardware, same config, same Ubuntu image across the board.

### Networking Gear

- **Router:** GL.iNet GL-SFT1200 (Opal) — handles DHCP, DNS forwarding, and the WAN/LAN boundary.
- **Switch:** Netgear GS305EP — 5-port gigabit managed switch, used as a flat L2 fabric for the cluster.
---

## Network Design

The entire lab runs on `192.168.0.0/24`. The address space is divided to keep infrastructure IPs stable and away from the DHCP pool:

| Device    | IP             | Assignment              |
| --------- | -------------- | ----------------------- |
| Router    | `192.168.0.1`  | Static (gateway)        |
| Switch    | `192.168.0.2`  | Static (manual)         |
| Node 1    | `192.168.0.10` | Static (Netplan)        |
| Node 2    | `192.168.0.11` | Static (Netplan)        |
| Node 3    | `192.168.0.12` | Static (Netplan)        |
| Pi-hole   | `192.168.0.30` | Cilium LB pool          |
| Traefik   | `192.168.0.31` | Cilium LB pool          |
| DHCP pool | `.100 – .250`  | Dynamic (Wi-Fi clients) |

Nodes receive their IPs via Netplan static configuration. Each node has a custom `/etc/netplan/*.yaml` that pins the address and sets the default gateway to `192.168.0.1`. Since the router at the gateway is configured to use the Pi-hole IP for DNS resolution, the nodes automatically benefit from DNS filtering and local naming without needing individual DNS overrides in their local configurations.

---

## Operating System & Cluster Bootstrap

The first homelab used Talos Linux on a single node. This time, the nodes run **Ubuntu Server**, more familiar and easier to debug when things inevitably go sideways in a three-node cluster.

The cluster is bootstrapped with **kubeadm**, orchestrated by an **Ansible** playbook that runs the full setup from my laptop against all three nodes. The playbook handles everything in sequence:

1. **Wipe**: nukes any previous K3s or kubeadm state, resets CNI interfaces and iptables
2. **OS prep**: disables swap, loads `overlay` and `br_netfilter` kernel modules, sets sysctl networking params
3. **containerd**: installs it, generates the default config, and forces `SystemdCgroup = true` (required for kubeadm)
4. **K8s tooling**: adds the Kubernetes apt repo, installs and holds `kubelet`, `kubeadm`, `kubectl`
5. **Master init**: runs `kubeadm init` on Node 1, waits for the API server, generates a join token, and fetches the kubeconfig to my laptop at `~/.kube/config-homelab`
6. **Worker join**: runs the join command on Nodes 2 and 3 one at a time
7. **Post-setup**: labels worker nodes, installs the local-path provisioner as the default `StorageClass`

Running the whole thing with `ansible-playbook site.yml` takes a few minutes and results in a fresh cluster with no manual steps.

---

## GitOps with Flux CD

Once the cluster is up, Flux CD takes over. It points at a GitHub repo and reconciles whatever's in git to the cluster. The structure:

```text
├── apps
│   ├── base        # Base manifests for each app
│   └── production  # Production overlays
├── infrastructure
│   └── helm        # HelmRepositories
└── clusters
    └── production  # Flux entrypoint kustomizations
```

I plan on adding testing and staging environments to the workflow to better mirror a professional setup.

---

## Cilium: CNI + Load Balancer

### Why Cilium?

Cilium replaces the legacy `kube-proxy` with eBPF, a modern and more efficient data plane that is fundamentally superior to iptables-based routing. It also handles L2 announcements natively, eliminating the need for MetalLB.

### How it's configured

Cilium runs in VXLAN tunnel mode (MTU set to `1400` to make room for the VXLAN overhead), with `kube-proxy` replacement fully enabled:

```yaml
routingMode: "tunnel"
tunnelProtocol: "vxlan"
mtu: 1400
kubeProxyReplacement: "true"
l2announcements:
  enabled: true
devices: "enp1s0"
```

### IP Pool

A `CiliumLoadBalancerIPPool` reserves the range `192.168.0.30 – 192.168.0.50` for services that need a real LAN IP:

```yaml
apiVersion: cilium.io/v2
kind: CiliumLoadBalancerIPPool
metadata:
  name: default-pool
spec:
  blocks:
    - start: 192.168.0.30
      stop: 192.168.0.50
```

A `CiliumL2AnnouncementPolicy` then tells Cilium to advertise those IPs via ARP on `enp1s0` from any node. When a `LoadBalancer` service is created with a fixed IP from that range, Cilium picks a node, wins the ARP lease, and starts responding to ARP requests for that IP. The rest of the LAN thinks it's just a regular host.


---

## Traefik: Ingress Controller

Traefik sits at `192.168.0.31` (assigned by Cilium's LB pool) and handles all HTTP and HTTPS routing into the cluster. It's deployed via Helm and configured as a `LoadBalancer` service:

```yaml
service:
  type: LoadBalancer
  spec:
    loadBalancerIP: 192.168.0.31
    externalTrafficPolicy: Cluster
  loadBalancerClass: io.cilium/l2-announcer
ports:
  web:
    exposedPort: 80
  websecure:
    exposedPort: 443
```

Rather than using the standard Kubernetes `Ingress` resource, Traefik's own `IngressRoute` CRD is used everywhere. It exposes the full feature set, per-route TLS secret binding, middleware chains, TCP routing, things the basic `Ingress` spec can't express cleanly.

Here's what an IngressRoute looks like for one of my apps:

```yaml
apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata:
  name: linkding
  namespace: linkding
spec:
  entryPoints:
    - websecure
  routes:
    - match: Host(`linkding.joesabbagh.com`)
      kind: Rule
      services:
        - name: linkding
          port: 80
  tls:
    secretName: linkding-tls
```

The `secretName` is a Kubernetes Secret populated by cert-manager.

---

## TLS: cert-manager + Cloudflare DNS-01

This was the part I was most unsure about going in, and it turned out to be the cleanest piece of the whole stack.

The goal: real, trusted TLS certificates for all my local apps — without opening any ports on the router, and without any of this traffic touching the public internet.

The trick is **Let's Encrypt's DNS-01 challenge**. Instead of proving domain ownership by serving a file over HTTP (which would require port 80 to be reachable from the internet), DNS-01 does it by adding a TXT record to Cloudflare's DNS via API. Let's Encrypt checks that record, confirms I control the domain, and issues the cert. No inbound connections required.

cert-manager handles this automatically with a `ClusterIssuer`:

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-dns
spec:
  acme:
    email: joe.sabbagh2001@gmail.com
    server: https://acme-v02.api.letsencrypt.org/directory
    solvers:
      - dns01:
          cloudflare:
            apiTokenSecretRef:
              name: cloudflare-dns-api-token
              key: api-token
```

Each app declares a `Certificate` resource. cert-manager does the ACME dance, stores the cert in a Kubernetes Secret, and renews it automatically before expiry. Traefik picks it up from the Secret and serves HTTPS. Done.

Here's an example for Linkding:

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name:  linkding-cert
spec:
  secretName: linkding-tls
  dnsNames:
    - linkding.joesabbagh.com
  issuerRef:
    name: letsencrypt-dns
    kind: ClusterIssuer
```


Also the domain `joesabbagh.com` has 0 public `A` records, only Pi-hole knows those hostnames resolve to `192.168.0.31`. So everything is hidden from the public internet. 

---

## Pi-hole: Local DNS

Pi-hole acts as the primary DNS server for the entire network, configured at the router level to handle all local queries.

It does two things here:

1. **Ad blocking**: filters ad and tracking domains for everything on the network.
2. **Local DNS**: resolves `*.joesabbagh.com` hostnames to `192.168.0.31` (Traefik's IP), so devices on the LAN can reach cluster apps by hostname.

The DNS records in Pi-hole look like this:

| Hostname                  | →   | IP             |
| ------------------------- | --- | -------------- |
| `traefik.joesabbagh.com`  | →   | `192.168.0.31` |
| `pihole.joesabbagh.com`   | →   | `192.168.0.31` |
| `linkding.joesabbagh.com` | →   | `192.168.0.31` |
| `jellyfin.joesabbagh.com` | →   | `192.168.0.31` |

All hostnames point to Traefik. Traefik then routes to the right pod based on the `Host()` rule.

---

## Tailscale: Remote Access

The last piece. When I'm away from home and want to reach the cluster, I use Tailscale.

The **Tailscale Operator** runs in the cluster and manages a `Connector` resource that acts as a **subnet router**. It advertises my entire home LAN (`192.168.0.0/24`) into my Tailscale tailnet:

```yaml
apiVersion: tailscale.com/v1alpha1
kind: Connector
metadata:
  name: homelab-subnet-router
spec:
  hostnamePrefix: homelab-subnet
  subnetRouter:
    advertiseRoutes:
      - "192.168.0.0/24"
```

Once the subnet route is approved in the Tailscale admin console, any device in my tailnet can reach `192.168.0.x` addresses directly, including `192.168.0.31` (Traefik) and `192.168.0.30` (Pi-hole).

I also push Pi-hole as the DNS server for my tailnet. That means when I'm on my phone remotely, `linkding.joesabbagh.com` resolves to `192.168.0.31` via Pi-hole, Traefik routes it to the linkding pod, and I get the exact same HTTPS experience I'd have sitting at home.

No open router ports. No public IP exposure. Just Tailscale's encrypted P2P tunnel.

---
## How It All Fits Together

```markdown

  [LAN / Tailscale device]
        │
        ▼
  Pi-hole @ 192.168.0.30:53
  linkding.joesabbagh.com → 192.168.0.31
        │
        ▼
  Traefik @ 192.168.0.31:443
  (Cilium ARP-announced on enp1s0)
        │
        ▼
  IngressRoute: Host(`linkding.joesabbagh.com`)
  TLS terminated with cert-manager cert
        │
        ▼
  Linkding pod (in namespace linkding)
```

The whole chain IP assignment, ARP announcement, DNS resolution, HTTPS routing, certificate issuance is declarative and lives in git. If I wipe a node and it rejoins the cluster, Flux reconciles everything back without me touching it.

---

## Wrap Up

The jump from one laptop with Cloudflare Tunnels to a three-node cluster with proper networking took a lot of debugging and research which made me learn a lot of new technologies and concepts, i really enjoyed setting up the different components from scratch and now every piece is clean and I understand why each one exists.

The thing I'm most happy about is that the whole setup is private. No ports open, no public-facing services. The cluster exists on my LAN, `joesabbagh.com` subdomains only resolve locally, and Tailscale handles remote access without any firewall rules. It feels right.

Beyond the privacy, the declarative nature of the setup via GitOps is incredibly freeing. Knowing that the entire state of my infrastructure lives in Git and is automatically reconciled by Flux gives me a level of confidence and reproducibility I didn't have before.

Stay tuned to see what else I'm planning for this cluster. Next up, I'll be sharing the details of my Jellyfin and "arr" stack setup, and how I handle automated media management and streaming across the network.

