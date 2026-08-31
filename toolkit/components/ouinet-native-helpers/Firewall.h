enum class InboundStatus {
  Allowed,           // Explicit Allow rule exists and applies
  Blocked,           // Explicit Block rule exists (rare for user rules, common for enterprise)
  BlockedByDefault,  // No rule found; default is Block (Public networks)
  AllowedByDefault,  // No rule found; default is Allow (uncommon for inbound)
  FirewallDisabled,  // Windows Firewall service is off
  Unknown            // COM error or failed to query
};

static const char16_t *InboundStatusStr(const InboundStatus is) {
  switch (is) {
    case InboundStatus::Allowed:
      return u"Allowed";
    case InboundStatus::Blocked:
      return u"Blocked";
    case InboundStatus::BlockedByDefault:
      return u"BlockedByDefault";
    case InboundStatus::AllowedByDefault:
      return u"AllowedByDefault";
    case InboundStatus::FirewallDisabled:
      return u"FirewallDisabled";
      // case InboundStatus::Unknown:
    default:
      return u"Unknown";
  }
}
