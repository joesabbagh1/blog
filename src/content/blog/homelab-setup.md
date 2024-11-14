---
author: Joe Sabbagh
pubDatetime: 2024-11-15
title: Transforming an Old Laptop into a Kubernetes Homelab
featured: false
tags:
  - homelab
  - kubernetes
  - gitops
  - cloudflare
description: A look into setting up a Kubernetes cluster with Talos Linux and GitOps on an old laptop.
---

<base target="_blank">

Years ago, when I first watched _Mr. Robot_ and saw Elliot tinkering with that room full of servers, I thought, “I want to be that guy.” I wanted my own setup, my own space to mess around with servers and dive into the tech. Well, I’m still not quite that guy, but now I have my old HP laptop running as my homelab. It’s not as dramatic, but that laptop has brought me a taste of what I imagined a personal space to experiment, break things, and build something real.

---

## Hardware

- HP Notebook 15
  - 8 GB RAM
  - Intel Core i7 (8th Gen)
  - 1 TB HDD
- Internet Connection
  - Router with a wired Ethernet connection

## Operating System

The server operates on Talos Linux, a purpose-built, lightweight OS designed specifically for Kubernetes clusters. Its fully immutable design means the system is read-only, significantly enhancing security and simplifying maintenance. Instead of relying on traditional tools like SSH, Talos Linux leverages a secure, gRPC-based API for all interactions.

The talosctl command-line tool uses this API to handle configuration and management, making operations more streamlined, automated, and secure. This API-driven approach reduces the attack surface and offers greater control over Kubernetes environments, making it an ideal choice for cloud-native infrastructure.

## Infrastructure as Code and GitOps

To automate and manage deployments, I’ve set up a monorepo using Flux CD—a tool that enables GitOps. Flux CD continuously monitors the GitHub repository for changes, automatically deploying updates when a change is detected. This ensures that the infrastructure and applications remain consistent and up to date with the repository.

The monorepo is structured as follows:

```text
├── apps
│   ├── base           # Base configurations for all apps
│   └── production     # Production-specific configurations
├── infrastructure
│   ├── base           # Base infrastructure setup (e.g., networking, storage)
│   └── production     # Production-specific infrastructure configuration
└── clusters
    └── production     # Cluster-specific configuration for production
```

## Exposing Apps to the Public Internet

All my applications are currently accessible on the local network using a **NodePort** service. To make them publicly available, I use [Cloudflare Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/), which securely route traffic from the internet to my internal services without exposing my IP address.

For a detailed setup guide, you can refer to Cloudflare's documentation: [**Use cloudflared to expose a Kubernetes app to the Internet**](https://developers.cloudflare.com/cloudflare-one/tutorials/many-cfd-one-tunnel/). This guide walks through the steps of setting up a Cloudflare Tunnel to securely expose Kubernetes apps.

I also purchased a domain name, _**joehomelab.cc**_, for about $8 per year, which is used by the tunnels. I create a separate subdomain for each application I deploy, ensuring organized and easy access.

## Deployed Apps

I have deployed the following applications in my homelab:

- **Linkding**: A lightweight and simple bookmark manager.
- **Homepage**: A customizable dashboard serving as the central hub for my homelab.
- **Jellyfin**: A media server for streaming and managing my media collection.
- **Grafana & Prometheus**: Tools for real-time monitoring and visualization of system metrics.

I'm planning to host more applications in the future, for now I'm focusing on optimizing the whole setup and making it more secure.

## Wrap Up

Building this homelab has been a great experience. I've learned a ton of new concepts, and it's been a lot of fun. If you're curious about Kubernetes, servers, or just looking to pick up new skills in your free time, I definitely recommend giving it a try. It's a rewarding way to learn and explore.
