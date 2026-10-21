---
author: Joe Sabbagh
pubDatetime: 2026-10-21
title: A container is a process
featured: false
draft: true
tags:
  - linux
  - containers
  - docker
description: I started a container and found the same process twice, once as pid 3627 on the VM and once as pid 1 inside.
---

<base target="_blank">

I wanted to see what is actually running when a container runs. The machine in front of me is a Mac. It cannot create Linux namespaces, so the lab is a privileged Ubuntu container on Docker Desktop. The kernel I kept reading was `6.10.14-linuxkit`, aarch64. That is the Docker Desktop VM. The container did not boot a kernel of its own.

I started `sleep 300` in that lab image and asked Docker for the process from the outside. `docker top` showed it on the VM:

```text
PID 3627   PPID 3608   sleep 300
```

From inside the container, the same sleep was pid 1, and its parent was 0:

```text
PID 1   PPID 0   sleep
```

Pid 1 and a parent of 0 are the pid namespace. The process that started `sleep` lives outside that namespace, so the kernel has no parent pid it is allowed to show. A shell I exec'd into the same container was pid 6, also with parent 0, and it held the same namespace ids as pid 1. One container is one set of namespaces, shared by every process in it.

`/proc/self/ns` and `/proc/1/ns` were the same links. Each link is a kernel object, and the number is its inode. On that run they were `cgroup:[4026532691]`, `ipc:[4026532561]`, `mnt:[4026532559]`, `net:[4026532563]`, `pid:[4026532562]`, `time:[4026531834]`, `user:[4026531837]`, and `uts:[4026532560]`.

A second privileged container, started while the first was still up, printed the same `6.10.14-linuxkit` and the same user and time inodes: `user:[4026531837]` and `time:[4026531834]`. Its pid, uts, and net inodes were different. Docker had created a pid namespace, a UTS namespace, and a network namespace for each container. It had not created a user namespace or a time namespace. Root inside the lab is the VM's root.

The hostname inside the container was the container id. The Mac's hostname did not change. UTS is per container. The kernel is not.

A virtual machine boots its own kernel and gets its own copy of the page cache, the scheduler, and the drivers. A container is a process on a kernel that is already running. The rest of this series is the set of knobs that process gets: namespaces for what it can see, cgroups for how much it can use, and a root filesystem for which files it sees. The first fact is the one I can now point at. Sleep was pid 3627 on the VM, and pid 1 in the container, and both of those numbers were the same program on `linuxkit`.
