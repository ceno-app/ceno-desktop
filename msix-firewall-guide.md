# How to add firewall exception for MSIX builds using MSIX Packaging Tool

Near the end of the regular process there is a step called `Create package`. Click `Package editor`, scroll down to `Manifest file` section, click `Open file`.

Add `desktop2` namespace to `<Package>` tag, include it in `IgnorableNamespaces`.
```xml
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" 
...
  xmlns:desktop2="http://schemas.microsoft.com/appx/manifest/desktop/windows10/2"
  IgnorableNamespaces="uap uap2 uap3 uap10 rescap com desktop2">
```

The exception rule should be added to `<Package><Extensions></Extensions></Package>`:
```xml
<Package ...>
<Extensions>
...
    <desktop2:Extension Category="windows.firewallRules">
      <desktop2:FirewallRules Executable="VFS\ProgramFilesX64\Ceno Alpha\Ouinet\ceno-network-client.exe">
        <desktop2:Rule Direction="in"
                       IPProtocol="TCP"
                       LocalPortMin="49152"
                       LocalPortMax="65535"
                       Profile="all" />
        <desktop2:Rule Direction="in"
                       IPProtocol="UDP"
                       LocalPortMin="49152"
                       LocalPortMax="65535"
                       Profile="all" />
      </desktop2:FirewallRules>
    </desktop2:Extension>
</Extensions>
</Package>
```

This rule uses ephemeral ports 49152-65535. Will work unless the system has a non default ephemeral port range, expanded downwards. A firewall dialog will be shown in that non default case.