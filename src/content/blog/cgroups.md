---
author: Joe Sabbagh
pubDatetime: 2026-10-21
title: cgroups
featured: false
draft: true
tags:
  - linux
  - containers
  - docker
description: I put a busy loop under a 5% CPU quota and a write under an 8 MiB memory cap, and the pid namespace never changed.
---

<base target="_blank">

Namespaces change what a process can see. They do not change how much CPU or memory it can burn. That is cgroups. On this lab the hierarchy is cgroup v2, mounted read-write at `/sys/fs/cgroup`, and the controllers on offer were `cpuset cpu io memory hugetlb pids rdma`. The container has its own cgroup namespace, so that directory is the container's cgroup on the linuxkit host, presented as the root.

The first thing I tried was to turn the controllers on for children:

```text
echo "+cpu +memory" > /sys/fs/cgroup/cgroup.subtree_control
```

The kernel answered `Device or resource busy`, exit code 1. The root still had processes in `cgroup.procs` (pids 1, 13, and 14 on that run). cgroup v2 will not turn a cgroup into an internal node while it still has member processes. This namespace root is not exempt. It is the container's cgroup, and pid 1 lives in it.

I created `/sys/fs/cgroup/init`, moved those pids into it, and wrote the controllers again. The root's process list was empty, `init` held the container's processes, and `cgroup.subtree_control` read `cpu memory`. I did not have to switch the container to the host cgroup namespace.

CPU quota is two integers in `cpu.max`: microseconds of runtime, and the length of the period. I wrote `5000 100000` on a child cgroup. That is 5 ms of runtime in every 100 ms. A shell joined that cgroup and exec'd `yes`. `timeout` stopped it after 2 seconds, which is exit 124, the timeout's own exit. From inside the cgroup, before the loop, the hostname was still the container id `8d2216b8d760`, the pid namespace was still `pid:[4026532562]`, and `ps` still listed 6 processes.

`cpu.stat` for the limited run:

```text
usage_usec 94826
nr_periods 21
nr_throttled 21
throttled_usec 1971306
```

The process got about 95 ms of CPU across those 2 seconds. All 21 periods were throttled, for about 1.97 s. The same loop in a cgroup left at `max 100000` used `usage_usec 1989753` and was throttled zero times. Same program, same wall clock. The quota is what changed.

Memory was a separate child, `memory.max` of `8388608` and `memory.swap.max` of 0. A shell joined it and `dd` wrote 32 MiB from `/dev/zero` onto a tmpfs. tmpfs pages are charged to the writer's memory cgroup. The shell could still see pid 1. The write did not finish. Nothing printed `survived`. The exit code was 137. `memory.peak` was exactly `8388608`. `memory.events` went from zeros to `max 53`, `oom 2`, `oom_kill 2`.

`dmesg` for that container's `lab-mem` cgroup named both victims: bash pid 4296, then dd pid 4301, both `CONSTRAINT_MEMCG`. `memory.current` was still `6885376` after the kill, because the tmpfs file was still charged. Deleting the file and unmounting the tmpfs dropped it to `36864`.

The cgroup killed and throttled. It did not hide the hostname, the pid namespace, or pid 1. That is the split. Namespaces are a view. Cgroups are an account, and the kernel enforces the account on the processes that have been written into `cgroup.procs`.
