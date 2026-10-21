---
author: Joe Sabbagh
pubDatetime: 2026-10-21
title: A runtime in a few hundred lines
featured: false
draft: true
tags:
  - linux
  - containers
  - docker
description: A shell script and a 142-line Go program that both end in a BusyBox shell with pid 1 and its own hostname.
---

<base target="_blank">

Once the pieces exist, the question is the order. What is the shortest sequence that looks like `docker run`?

The script is `unshare`, then a hostname, then `pivot_root` onto a BusyBox tmpfs, then a procfs, then `exec` of a shell. I built the root on a tmpfs before the `unshare`, and I wrote the shell's script onto that tmpfs so it would still be readable after the old root was unmounted. The applet symlinks were installed from inside a `chroot`, so they point at `/bin/busybox`.

```bash
unshare --mount --uts --pid --fork bash -eu -c '...'
```

`--fork` is there because of the pid namespace. `unshare` stays in the old one. The child enters the new one and is pid 1. I did not let `unshare` mount proc. A proc mount made before the pivot would sit on the old root. Inside the child I set the hostname to `shell-lab`, made the mount tree private, `pivot_root . oldroot`, mounted proc, and `umount -l` of the old root. `exec /bin/sh` replaced the child. The pid stayed 1.

The shell printed:

```text
hostname=shell-lab
pid=1
proc1=sh
ls /:
bin
oldroot
proc
run.sh
this-is-the-new-root
tmp
```

The dev container's hostname on that run was `81fdc4d8f6a4`, and its pid 1 was bash. `/proc/1/comm` inside the new namespace was `sh`. `/proc/1/root` could not read a marker I had left on the dev container. In the pivot experiment, without a new pid namespace, that path still could.

`strace` on the script shows the kernel calls under the utilities:

```text
unshare(CLONE_NEWNS|CLONE_NEWUTS|CLONE_NEWPID) = 0
sethostname("shell-lab", 9) = 0
mount("none", "/", NULL, MS_REC|MS_PRIVATE, NULL) = 0
pivot_root(".", "oldroot") = 0
mount("proc", "/proc", "proc", MS_SILENT, NULL) = 0
umount2("/oldroot", MNT_DETACH) = 0
execve("/bin/sh", ["/bin/sh", "/run.sh"], ...) = 0
```

`unshare` the program had already made the new mount namespace private once, before `sethostname`. The script's own `mount --make-rprivate /` is the call above. `hostname` is a separate binary, and that binary is what calls `sethostname`.

I reimplemented that sequence in Go. `main.go` is 142 lines. The command is `run`. It prepares `/tmp/go-rootfs` in the parent, then clones a child that is born inside the new namespaces. Go is already multithreaded when `main` runs, so the parent does not call `unshare` on itself. The clone carries `CLONE_NEWNS`, `CLONE_NEWUTS`, and `CLONE_NEWPID`, and the child execs the same binary. An environment variable tells that second start that it is the child.

Built on the Mac with `CGO_ENABLED=0 GOOS=linux GOARCH=arm64`, and run inside the privileged lab:

```text
hostname=go-lab
pid=1
proc1=sh
bin
oldroot
proc
this-is-the-new-root
tmp
```

`strace` on that process is the same list, without the extra utilities. `clone` includes Go's `CLONE_VFORK` and the three namespace flags. Then `sethostname("go-lab")`, `pivot_root(".", "oldroot")`, `mount("proc", "/proc", "proc")`, `umount2("/oldroot", MNT_DETACH)`, and `execve("/bin/sh")`.

runc reads the same decisions from an OCI `config.json`. I used spec v1.2.0 as the map, and the program does not parse the file. `root.path` is the directory we pivot into, `/tmp/go-rootfs`. `process.args` is the argv of the exec. `process.cwd` is `/` after the `chdir`. `process.env` is the `PATH=/bin` we hand to `execve`. `hostname` is its own field, applied with `sethostname` in the UTS namespace. `linux.namespaces` lists types. With no `path`, the runtime creates the namespace. The three types this program creates are `mount`, `uts`, and `pid`. The rest are inherited, which is also what Docker did for user and time on this lab. `linux.resources.memory.limit` and `cpu.quota` / `cpu.period` are the cgroup files from the quota experiment, `memory.max` and `cpu.max`. This program does not write them. `mounts` is where a proc entry would be declared. The code mounts proc directly.

The shell script and the Go program are the same kernel sequence. runc's config file is the description of that sequence after you have more than one container to start.
