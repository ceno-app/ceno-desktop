# How to add firewall rule for MSIX builds using MSIX Packaging Tool

Near the end of the regular process there is a step called `Create package`. Click `Package editor`, scroll down to `Manifest file` section, click `Open file`.

Add `desktop2` namespace to `<Package>` tag, include it in `IgnorableNamespaces`.
```xml
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" 
...
  xmlns:desktop2="http://schemas.microsoft.com/appx/manifest/desktop/windows10/2"
  IgnorableNamespaces="uap uap2 uap3 uap10 rescap com desktop2">
```

Firewall rules should be added to `<Package><Extensions></Extensions></Package>`:
```xml
<Package ...>
<Extensions>
...
    <desktop2:Extension Category="windows.firewallRules">
      <desktop2:FirewallRules Executable="VFS\ProgramFilesX64\Ceno Alpha\Ouinet\ceno-network-client.exe">
        <desktop2:Rule Direction="in"
                       IPProtocol="UDP"
                       LocalPortMin="28729"
                       LocalPortMax="28729"
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

First rule adds default UDP multiplexer listening on port 28729, second rule is for fallback to ephemeral ports when Ouinet fails to open the main port. Fallback rule works unless the system has a non default ephemeral port range, expanded downwards. A firewall dialog will be shown in that non default case.
