---
author: Joe Sabbagh
pubDatetime: 2026-05-13
title: "Running Windows VMs on Kubernetes with KubeVirt"
featured: true
tags:
  - homelab
  - kubernetes
  - kubevirt
  - virtualization
  - windows
description: How I added KubeVirt to my homelab cluster to run Windows 10 VMs as first-class Kubernetes workloads.
---

<base target="_blank">

I recently needed to run a couple of Windows virtual machines on my homelab. The obvious choice for many would be to use Proxmox, but since I already have a fully configured bare-metal Kubernetes cluster running with Cilium networking and GitOps workflows, introducing a separate hypervisor layer felt counter-intuitive. 

Instead, I wanted to run actual virtual machines managed natively by Kubernetes, alongside my regular pods. That's exactly what [KubeVirt](https://kubevirt.io/) enables.

Here's how I installed KubeVirt, handled Windows ISOs via the Containerized Data Importer (CDI), and the exact manifests used to spin up a Windows 10 VM with RDP access over Cilium's L2 load balancer.

All the config lives in my [homelab repo](https://github.com/joesabbagh1/homelab) on GitHub.

---

## 1. Installing KubeVirt

KubeVirt installs via an operator. I manage this through Flux, pinning it to `v1.8.2`:

```yaml
# kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: kubevirt
resources:
  - https://github.com/kubevirt/kubevirt/releases/download/v1.8.2/kubevirt-operator.yaml
  - kubevirt-cr.yaml
```

The operator handles the heavy lifting of deploying KubeVirt's core components (like `virt-api` and `virt-controller`). We then create a `KubeVirt` custom resource to configure the installation, enabling features like `LiveMigration` and setting a safe update strategy so our VMs don't unexpectedly restart if the operator upgrades:

```yaml
# kubevirt-cr.yaml
apiVersion: kubevirt.io/v1
kind: KubeVirt
metadata:
  name: kubevirt
  namespace: kubevirt
spec:
  configuration:
    developerConfiguration:
      featureGates:
        - LiveMigration
        - Snapshot
  workloadUpdateStrategy:
    workloadUpdateMethods:
      - LiveMigrate
```

---

## 2. Disk Management with CDI

Virtual machines need disk images. CDI introduces the `DataVolume` CRD to pull ISOs and raw images into PVCs.

Instead of manually provisioning PersistentVolumeClaims (PVCs) and figuring out how to copy data into them, CDI handles the downloading and unpacking of images automatically.

I use three DataVolumes for the Windows VM:

**1. Blank Boot Disk (60Gi)**
This creates an empty 60Gi PVC. When the VM boots from the installation ISO, this is the drive where Windows will actually be installed.
```yaml
apiVersion: cdi.kubevirt.io/v1beta1
kind: DataVolume
metadata:
  name: win10-disk
spec:
  source:
    blank: {}
  pvc:
    accessModes: [ReadWriteOnce]
    resources: { requests: { storage: 60Gi } }
    storageClassName: local-path
```

**2. VirtIO Drivers ISO**
Because KubeVirt runs on KVM, Windows needs paravirtualized drivers to perform well. Without these VirtIO drivers, Windows falls back to emulated IDE and e1000 networking, which are painfully slow. CDI downloads this ISO directly from Fedora's servers during deployment.
```yaml
apiVersion: cdi.kubevirt.io/v1beta1
kind: DataVolume
metadata:
  name: virtio-win-iso
spec:
  source:
    http:
      url: "https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/virtio-win.iso"
  pvc:
    accessModes: [ReadWriteOnce]
    resources: { requests: { storage: 1Gi } }
    storageClassName: local-path
```

**3. Windows 10 ISO** 
Since the Windows ISO is a massive file, managing it declaratively through GitOps is tricky. Instead, we use `virtctl` to manually stream the ISO directly from my laptop into a PVC. This keeps the large binary out of git and prevents Flux from constantly trying to reconcile it.
```bash
virtctl image-upload dv win10-iso \
  --size=8Gi \
  --image-path=/path/to/Win10.iso \
  --storage-class=local-path \
  --insecure
```

---

## 3. The VirtualMachine Manifest

The `VirtualMachine` resource ties everything together. It defines the virtual hardware (CPU, memory, chipset) and attaches the DataVolumes we created above. 

A few critical settings make this work smoothly for Windows:
- **`runStrategy: RerunOnFailure`**: This ensures that if I shut down Windows gracefully from the Start menu, Kubernetes respects the shutdown and doesn't immediately forcefully restart the pod.
- **`type: q35` & `efi`**: This provides a modern, PCIe-capable motherboard and UEFI boot process.
- **`hyperv` features**: These "enlightenments" tell Windows that it is running in a VM, allowing it to optimize its own behavior and significantly reduce CPU overhead.
- **`tablet` input**: This absolute pointing device prevents annoying mouse cursor drift if you use a VNC console.

I've omitted some boilerplate (like clock timers and minor features):

```yaml
apiVersion: kubevirt.io/v1
kind: VirtualMachine
metadata:
  name: win10-01
spec:
  runStrategy: RerunOnFailure # Allows graceful shutdown from inside Windows
  template:
    spec:
      domain:
        cpu: { cores: 4 }
        memory: { guest: 4Gi }
        machine:
          type: q35 # Modern PCIe-capable chipset
        firmware:
          bootloader:
            efi: { secureBoot: false }
        features:
          hyperv:
            relaxed: { enabled: true }
            vapic: { enabled: true }
            spinlocks: { enabled: true, spinlocks: 8191 }
            # ... other enlightenments omitted to keep this readable
        devices:
          disks:
            - name: bootdisk
              bootOrder: 1
              disk: { bus: virtio }
          interfaces:
            - name: default
              model: virtio
              masquerade: {}
          inputs:
            - type: tablet
              bus: usb
              name: tablet
      networks:
        - name: default
          pod: {}
      volumes:
        - name: bootdisk
          dataVolume:
            name: win10-disk
```

Notice how the disks and network interfaces are explicitly set to use the `virtio` bus. During the Windows installation, we load the drivers from the VirtIO ISO (attached earlier) to recognize these high-performance virtual devices.

---

## 4. RDP Access via Cilium

By default, KubeVirt uses `masquerade` mode (NAT) to wire the VM into the Kubernetes pod network. While this is great for outgoing internet access, it means the VM doesn't have an IP on my home network. 

To fix this, I expose the RDP port (3389) using a Kubernetes `LoadBalancer` service. By binding it to my `io.cilium/l2-announcer` class, Cilium intercepts the service request, grabs a real IP address from my local network pool, and broadcasts it to my router via ARP.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: win10-01-rdp
spec:
  type: LoadBalancer
  loadBalancerClass: io.cilium/l2-announcer
  selector:
    app: win10-01
  ports:
    - name: rdp
      port: 3389
      targetPort: 3389
      protocol: TCP
```

This completely abstracts away the Kubernetes networking layer. I just open Microsoft Remote Desktop, point it at the IP Cilium assigned, and I'm instantly connected to the VM as if it were a physical PC sitting on my desk.

---

## 5. Web UI: kubevirt-manager

While RDP is perfect for daily use, it isn't available during the initial Windows installation. You still need a way to click through the setup screens and install the VirtIO drivers.

For this, I run [kubevirt-manager](https://kubevirt-manager.io/). It provides a fantastic web-based VNC console that connects directly to the VM's display buffer. I expose the dashboard using a Traefik `IngressRoute`:

```yaml
apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata:
  name: kubevirt-manager
spec:
  entryPoints: [websecure]
  routes:
    - match: Host(`kubevirt.joesabbagh.com`)
      kind: Rule
      services:
        - name: kubevirt-manager
          port: 8080
  tls:
    secretName: kubevirt-manager-tls
```

## Wrap Up

That's pretty much it. Getting a Windows VM running on bare-metal Kubernetes took some trial and error with the drivers, but having it fully managed by Flux alongside my regular containers is a huge win. The RDP setup works exactly as you'd want thanks to Cilium handling the LAN IP, so it just feels like any other machine on my home network.
