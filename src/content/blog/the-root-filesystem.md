---
author: Joe Sabbagh
pubDatetime: 2026-10-21
title: The root filesystem
featured: false
draft: true
tags:
  - linux
  - containers
  - docker
description: chroot let me walk back out to a marker file. pivot_root did not. An image turned out to be three layer tars and a whiteout.
---

<base target="_blank">

A process's root directory is a pointer. `chroot` moves that pointer. I wanted to see how far that gets you, and what a container does instead.

The lab container wrote `phase4-marker cd7ba1a74f9f` to `/tmp/host-marker`. I built a directory jail with BusyBox and a small static C program. `gcc -static` produced a binary `ldd` called "not a dynamic executable." Inside the jail, `ls /` showed `bin`, `only-in-jail`, and `tmp`. `/tmp` in the jail was empty.

The `chroot` command calls `chroot(2)` and then `chdir`s into the new root, so a second `chroot` command starts with its working directory already inside the jail. The C program calls the syscall on its own. It `chroot`s into a subdirectory named `escape`, does not `chdir`, walks `..` sixty-four times, `chroot`s to `.`, and opens `/tmp/host-marker`. That read returned the marker. The jail directory did not hold it. A root pointer, with the working directory left outside the new root, is not a boundary.

`pivot_root` is a different operation. It swaps the root mount of a mount namespace. I copied BusyBox onto a tmpfs and installed the applets from inside a `chroot`, so the symlinks say `/bin/busybox` and still resolve after `/` changes. Installed from the outside, `ls` had pointed at `/tmp/bbroot/bin/busybox`, which would dangle.

`unshare --mount` moved the child from `mnt:[4026532559]` to `mnt:[4026532692]`. Docker's mounts are shared, so the child ran `mount --make-rprivate /` before `pivot_root . oldroot`. The old root stayed mounted at `/oldroot`, and the marker was readable there. The same climb, run at that moment, failed with `fopen /tmp/host-marker: No such file or directory`. The tmpfs was already the root of the mount namespace. `..` stops at that root. `/oldroot` is a mount below it, not a parent the walk can reach.

`umount -l oldroot` removed the leftover path. `/` was then `bin`, `proc`, `tmp`, an empty `oldroot`, and a file called `this-is-the-new-root`. The root line in `/proc/mounts` was `tmpfs / tmpfs`. The marker path on the new root was gone, and the climb failed again.

One door stayed open. `/proc/1/root/tmp/host-marker` still printed the marker. The procfs I mounted was the parent's pid namespace, and pid 1 was still the dev container's bash. A later lab put the shell in its own pid namespace before mounting proc, and that read failed. The root filesystem change and the pid namespace are two steps.

The dev container's own `/` is already an overlay, and the kernel will not use an overlay directory as another overlay's writable layer. The failing mount exited 32, and `dmesg` said `overlay: filesystem on /tmp/phase4/bad-upper not supported as upperdir`. Upper and work went on a tmpfs. I wrote `modified` through the merged mount onto a file whose lower copy said `original`. Afterwards the lower file still said `original`, the upper file said `modified`, and a second file I never wrote existed only in the lower dir. That is copy-up. One file moves. The rest of the lower directory stays put.

An image is that lower directory, split into tars. I built a tiny image on the BusyBox 1.36 base: one `RUN` created `/layer-one.txt`, the next deleted it and created `/layer-two.txt`. `docker save` produced an archive whose `manifest.json` lists three gzip blobs, bottom to top. The first is the layer the pull downloaded, 1896265 bytes in the archive. The second is `layer-one.txt`, contents `created in the first layer`. The third tar lists:

```text
---------- 0/0               0 1970-01-01 00:00 .wh.layer-one.txt
-rw-r--r-- 0/0              28 2026-10-21 01:18 layer-two.txt
```

`.wh.layer-one.txt` is a regular file of size 0. That name is the deletion record. overlayfs does not honour the name. It hides a lower file when it sees a character device with device number 0/0. Creating that device on the extracted layer failed with `Operation not permitted`, because the extract sits on the container's overlay. The same `mknod` on a tmpfs succeeded. I copied the top layer onto that tmpfs, replaced the `.wh.` file with the 0/0 device, and stacked it above the other two layers. Upper and work were a second tmpfs.

The merged tree had BusyBox's `bin` and `usr`, it had `layer-two.txt`, and it did not have `layer-one.txt`. Layer 1's file still read `created in the first layer`. Writing a new string through the merged mount put that string only in the tmpfs upper dir. Both copies of the lower `layer-two.txt` still read `created in the second layer`.

So a root filesystem in this lab is three moves. `chroot` moves a pointer, and a second syscall can walk back. `pivot_root` plus an unmount replaces the root mount. An image is the lower stack under one more writable directory, and a whiteout is how a later tar says a file from an earlier tar is gone.
