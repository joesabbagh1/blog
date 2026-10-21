---
author: Joe Sabbagh
pubDatetime: 2026-10-21
title: Namespaces
featured: false
draft: true
tags:
  - linux
  - containers
  - docker
description: I called unshare once per namespace and wrote down the one thing each call changed.
---

<base target="_blank">

A namespace is a kernel object with an inode. Processes that point at the same inode share that view. `unshare` moves the next command into a new one and leaves the parent where it was. I ran it inside the same privileged lab container as the process experiment, on `6.10.14-linuxkit`, and changed one namespace at a time.

UTS is the hostname. `unshare --uts` followed by `hostname lab-uts` made the child's hostname `lab-uts` and moved its UTS inode from `uts:[4026532560]` to `uts:[4026532692]`. The pid namespace inode did not change. After the child exited, the parent hostname was still the container id.

The pid namespace needs `--fork`. `unshare` itself stays in the old pid namespace. The child is the one that enters the new one, and it has to be pid 1 there. `--mount-proc` mounts a new `/proc`, which also creates a mount namespace, otherwise `ps` would still be reading the parent's process list. The child reported `pid=1` and `pid:[4026532693]`. `ps` showed bash as pid 1 and `ps` as its child. Parent pid 0 again means the parent of that shell sits outside the new namespace.

Non-interactive bash will exec its last command instead of forking. The first version of the script ended on `ps`, so `ps` replaced bash and showed up as pid 1. The script now ends on a shell builtin so bash stays pid 1. That replacement is what happens in a container when pid 1 is the program you exec'd, with no init beside it.

A mount namespace decides which mounts a process has. I created `/tmp/mount-demo` on the shared root, then in `unshare --mount` mounted a tmpfs there and wrote a file called `secret`. The child's mount inode changed. The parent listed the same directory and saw it empty. The directory was on the shared filesystem. The file was on a tmpfs that exists only in the child's mount namespace.

IPC is the System V tables. `unshare --ipc`, then a 4096-byte shared-memory segment. The child's `ipcs` showed it. The parent's `ipcs` was empty. Two listings, two kernel tables.

The network namespace is the one that feels like the container has lost its ethernet. The parent had `eth0` up. The child's net inode was `net:[4026532694]`, and `eth0` was gone. `lo` was there and `DOWN`. A new net namespace starts with its own loopback.

It also listed `tunl0`, `gre0`, `gretap0`, `erspan0`, `ip_vti0`, `ip6_vti0`, `sit0`, `ip6tnl0`, and `ip6gre0`. Those are not inherited from the parent. The linuxkit kernel has those tunnel modules loaded, and each module creates its fallback device in every new network namespace. `eth0` is a veth end Docker plugged into this container, so it stays in the parent's namespace.

The user namespace was the one Docker had skipped. `unshare --user --map-root-user` changed the user inode from `user:[4026531837]` to `user:[4026532693]`. `id` still printed uid 0. The map was:

```text
0    0    1
```

Inside uid 0 is outside uid 0, for a range of one id. The lab is already root in the VM's initial user namespace, so mapping root to root is the whole story. The new inode is the proof a user namespace was created. The uid came from that table.

Six calls, six inodes. The parent kept the old view every time. That is the whole mechanism behind "the container cannot see the host's processes" or "the container has its own hostname." Each of those sentences is one namespace, and each namespace is one of these inodes.
