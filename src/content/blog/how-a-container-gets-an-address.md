---
author: Joe Sabbagh
pubDatetime: 2026-10-21
title: How a container gets an address
featured: false
draft: true
tags:
  - linux
  - containers
  - docker
description: I gave a new network namespace a veth pair, a bridge, a default route, and a MASQUERADE rule, and curl came back HTTP 200.
---

<base target="_blank">

A new network namespace starts without the parent's ethernet. I had already seen that. `eth0` stayed behind, `lo` came up down, and the linuxkit tunnel modules added `tunl0`, `gre0`, `gretap0`, and the rest in every new namespace. An address has to be plugged in after that.

The dev container's `eth0` on this run was `172.17.0.2/16`. Forwarding was already on. The resolver in `/etc/resolv.conf` was `192.168.65.7`.

I created a namespace called `lab7` and a veth pair, `veth-host` and `veth-ns`. One end moved into the namespace. The other was enslaved to a bridge, `br-lab`, with `10.88.0.1/24`. Inside the namespace, `veth-ns` got `10.88.0.2/24` and a default route via `10.88.0.1`.

```text
veth-host@if11   UP    5e:57:ac:c4:65:4e
veth-ns@if12     UP    10.88.0.2/24    3a:78:e3:e2:20:96
```

The `@if` number is the peer's index on the other side of the pair. A packet that enters one end comes out the other. `busybox ping` from the namespace to `10.88.0.1` got one reply, 0.198 ms, no loss.

The link list inside the namespace still had the tunnel devices, all down, plus `lo` up and `veth-ns` up. The new namespace did not arrive empty.

`10.88.0.2` is not an address the rest of the network can route back to. The script appended one NAT rule:

```text
-A POSTROUTING -s 10.88.0.0/24 -o eth0 -j MASQUERADE
```

Packets from the namespace leave `eth0` with source `172.17.0.2`. Conntrack writes the replies back to `10.88.0.2`. The dev container's `FORWARD` policy was already `ACCEPT`. I also inserted two accepts for the bridge. `curl -4 http://example.com/` from inside the namespace, still using `192.168.65.7`, returned `HTTP/1.1 200 OK` from Cloudflare, and the body was the Example Domain page. The fallback I had written, a private `resolv.conf` pointing at `1.1.1.1`, never ran.

A published port is the opposite translation. BusyBox `httpd` in the namespace served `hello-from-lab7` on port 8080. A direct request to `10.88.0.2:8080` returned that string. Then two DNAT rules, both aimed at `10.88.0.2:8080`:

```text
-A PREROUTING -d 172.17.0.2/32 -p tcp --dport 8080 -j DNAT --to-destination 10.88.0.2:8080
-A OUTPUT     -d 172.17.0.2/32 -p tcp --dport 8080 -j DNAT --to-destination 10.88.0.2:8080
```

`curl http://172.17.0.2:8080/` ran in the dev container, so it was a locally generated packet and it matched `OUTPUT`. The response was `hello-from-lab7`. `PREROUTING` is the same translation for a packet that arrives from outside this namespace. I did not send one of those.

That is the whole path. The namespace has its own stack and no inherited `eth0`. A veth pair is the cable. The bridge holds the gateway address. The default route points at it. `MASQUERADE` is how packets from `10.88.0.2` get an address the outside will answer. DNAT is how an outside port becomes a socket inside the namespace. Docker's bridge and its published ports are this drawing, with more pairs on the same bridge.
