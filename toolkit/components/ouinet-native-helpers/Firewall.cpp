#include "nsCOMPtr.h"

#include "nsIThreadManager.h"
#include "nsThreadUtils.h"       // NS_NewNamedThread, NS_DispatchToMainThread
#include "nsServiceManagerUtils.h" // do_GetService
#include "nsLiteralString.h"     // NS_LITERAL_CSTRING, _ns

#include "nsCOMPtr.h"           // nsCOMPtr, do_GetService
#include "nsIObserver.h"        // nsIObserver interface
#include "nsIObserverService.h"        // nsIObserver interface
#include "nsIThreadManager.h"   // nsIThreadManager
#include "nsThreadUtils.h"      // NS_NewRunnableFunction, NS_DispatchToMainThread
#include "nsComponentManagerUtils.h" // do_GetService (alternative: nsServiceManagerUtils.h)
#include "nsLiteralString.h"    // NS_LITERAL_CSTRING, _ns literals
#include "mozilla/ScopeExit.h"
#include "nsThreadUtils.h"

#include "nsProxyRelease.h"

#include <windows.h>
#include <netfw.h>

#include "OuinetNativeHelpers.h"

namespace mozilla {

// Normalize paths: expand env vars, get full path, get long path, lowercase
static std::wstring normalizePath(const wchar_t* raw) {
    if (!raw) return std::wstring{};

    std::wstring result;

    // Expand environment variables (%ProgramFiles%, %AppData%)
    // Success returns length INCLUDING null, failure returns required size INCLUDING null
    std::wstring expanded(MAX_PATH, L'\0');
    if (const DWORD length = ExpandEnvironmentStringsW(raw, expanded.data(), MAX_PATH); length == 0) {
        // Error, keep original
        result = raw;
    } else if (length <= MAX_PATH) {
        // Success - length includes null terminator
        expanded.resize(length - 1);
        result = std::move(expanded);
    } else if (length <= 32768) { // length is required buffer size (including null)
        expanded.resize(length - 1);
        if (ExpandEnvironmentStringsW(raw, expanded.data(), length) != 0) {
            expanded.resize(length - 1);
            result = std::move(expanded);
        }
    }

    // Get full path (resolve relative paths)
    // Success returns length EXCLUDING null, failure returns required size INCLUDING null
    std::wstring fullPath(MAX_PATH, L'\0');
    if (const DWORD length = GetFullPathNameW(result.c_str(), MAX_PATH, fullPath.data(), nullptr); length == 0) {
        // Error
    } else if (length < MAX_PATH) {
        // Success - length is length without null terminator
        fullPath.resize(length);
        result = std::move(fullPath);
    } else if (length <= 32767) { // length is required size including null
        fullPath.resize(length);
        const DWORD len2 = GetFullPathNameW(result.c_str(), length, fullPath.data(), nullptr);
        if (len2 != 0 && len2 < length) {
            fullPath.resize(len2);
            result = std::move(fullPath);
        }
    }

    // Get long path (resolve 8.3 short names like PROGRA~1)
    // Success returns length EXCLUDING null, failure returns required size INCLUDING null
    std::wstring longPath(MAX_PATH, L'\0');
    if (const DWORD length = GetLongPathNameW(result.c_str(), longPath.data(), MAX_PATH); length == 0) {
        // Error or file doesn't exist - keep current result
    } else if (length < MAX_PATH) {
        // Success - length is length without null terminator
        longPath.resize(length);
        result = std::move(longPath);
    } else if (length <= 32767) { // length is required size including null
        longPath.resize(length);
        DWORD len2 = GetLongPathNameW(result.c_str(), longPath.data(), length);
        if (len2 != 0 && len2 < length) {
            longPath.resize(len2);
            result = std::move(longPath);
        }
    }

    CharLowerW(result.data());

    return result;
}

// Check if rule applies to any currently active profile
static bool RuleAppliesToCurrentProfiles(INetFwRule* rule, long activeProfiles) {
    long ruleProfiles = 0;
    rule->get_Profiles(&ruleProfiles);
    return (ruleProfiles & activeProfiles) != 0;
}

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
        case InboundStatus::Unknown:
            return u"Unknown";
    }
}

static INetFwPolicy2* getPolicy() {
    INetFwPolicy2* policy = nullptr;
    CoCreateInstance(
        __uuidof(NetFwPolicy2), nullptr, CLSCTX_INPROC_SERVER,
        __uuidof(INetFwPolicy2), (void**)&policy
    );
    return policy;
}

static InboundStatus CheckInboundFirewallStatus(INetFwPolicy2* policy, const std::wstring_view normalizedExePath) {
    // Get active profiles (bitmask of NET_FW_PROFILE_TYPE2)
    long activeProfiles = 0;
    policy->get_CurrentProfileTypes(&activeProfiles);

    // Check default inbound action and "block all" for the active profiles
    // Priority: Domain > Private > Public (if multiple NICs are active)
    NET_FW_PROFILE_TYPE2 profileToCheck = NET_FW_PROFILE2_PUBLIC;
    if (activeProfiles & NET_FW_PROFILE2_DOMAIN) profileToCheck = NET_FW_PROFILE2_DOMAIN;
    else if (activeProfiles & NET_FW_PROFILE2_PRIVATE) profileToCheck = NET_FW_PROFILE2_PRIVATE;

    VARIANT_BOOL fwEnabled = VARIANT_FALSE;
    policy->get_FirewallEnabled(profileToCheck, &fwEnabled);
    if (fwEnabled == VARIANT_FALSE) {
        return InboundStatus::FirewallDisabled;
    }

    // Check if "Block all inbound connections" is enabled (overrides all allow rules)
    VARIANT_BOOL blockAll = VARIANT_FALSE;
    policy->get_BlockAllInboundTraffic(profileToCheck, &blockAll);

    NET_FW_ACTION defaultAction = NET_FW_ACTION_BLOCK;
    policy->get_DefaultInboundAction(profileToCheck, &defaultAction);

    // Enumerate rules looking for our executable
    INetFwRules* rules = nullptr;
    policy->get_Rules(&rules);

    bool hasAllowRule = false;
    bool hasBlockRule = false;

    if (rules) {
        auto rulesGuard = MakeScopeExit([&rules] { rules->Release(); });

        IUnknown* pUnk = nullptr;
        rules->get__NewEnum(&pUnk);
        if (pUnk) {
            IEnumVARIANT* pEnum = nullptr;
            pUnk->QueryInterface(IID_IEnumVARIANT, (void**)&pEnum);
            pUnk->Release();

            if (pEnum) {
                auto pEnumGuard = MakeScopeExit([&pEnum] { pEnum->Release(); });
                VARIANT var;
                VariantInit(&var);
                ULONG fetched = 0;

                while (S_OK == pEnum->Next(1, &var, &fetched)) {
                    INetFwRule* rule = nullptr;
                    if (V_DISPATCH(&var)) {
                        V_DISPATCH(&var)->QueryInterface(IID_INetFwRule, (void**)&rule);
                    }
                    VariantClear(&var);

                    if (rule) {
                        auto ruleGuard = MakeScopeExit([&rule] { rule->Release(); });
                        BSTR bstrApp = nullptr;
                        rule->get_ApplicationName(&bstrApp);

                        if (bstrApp) {
                            const auto normalizedRulePath = normalizePath(bstrApp);
                            SysFreeString(bstrApp);
                            if (normalizedRulePath == normalizedExePath) {
                                NET_FW_RULE_DIRECTION dir;
                                rule->get_Direction(&dir);

                                if (dir == NET_FW_RULE_DIR_IN) {
                                    VARIANT_BOOL enabled = VARIANT_FALSE;
                                    rule->get_Enabled(&enabled);

                                    if (enabled == VARIANT_TRUE && RuleAppliesToCurrentProfiles(rule, activeProfiles)) {
                                        NET_FW_ACTION action;
                                        rule->get_Action(&action);
                                        if (action == NET_FW_ACTION_ALLOW) hasAllowRule = true;
                                        else if (action == NET_FW_ACTION_BLOCK) hasBlockRule = true;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Evaluation order matters: explicit Block > explicit Allow > default
    if (hasBlockRule) return InboundStatus::Blocked;
    if (hasAllowRule) {
        // Even with an Allow rule, "Block all inbound" (unchecked in UI) overrides everything
        if (blockAll == VARIANT_TRUE) return InboundStatus::BlockedByDefault;
        return InboundStatus::Allowed;
    }
    if (defaultAction == NET_FW_ACTION_BLOCK) return InboundStatus::BlockedByDefault;
    return InboundStatus::AllowedByDefault;
}

NS_IMETHODIMP
OuinetNativeHelpers::MonitorFirewall(const nsAString &executable, nsIObserver *callback) {
    if (!hShutdownEvent) {
        return NS_ERROR_OUT_OF_MEMORY;
    }
    if (!firewallMonitorThread) {
        nsresult rv = NS_NewNamedThread("FirewallMonitor", getter_AddRefs(firewallMonitorThread));
        NS_ENSURE_SUCCESS(rv, rv);
    }

    HKEY hKey;
    if (ERROR_SUCCESS != RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"SYSTEM\\CurrentControlSet\\Services\\SharedAccess\\Parameters\\FirewallPolicy", 0, KEY_NOTIFY | KEY_READ, &hKey)) {
        return NS_ERROR_FAILURE;
    }
    auto keyGuard = MakeScopeExit([&hKey]{ RegCloseKey(hKey); });

    HANDLE hShutdown = hShutdownEvent;

    // nsAString may not be null terminated.
    const std::wstring executableStr{
        reinterpret_cast<const wchar_t *>(executable.BeginReading()),
        executable.Length()
    };

    nsMainThreadPtrHandle<nsIObserver> callbackHandle(new nsMainThreadPtrHolder<nsIObserver>("OuinetFirewallCallback", callback));
    const auto rv = firewallMonitorThread->Dispatch(NS_NewRunnableFunction("FirewallMonitor", [
        hKey, keyGuard = std::move(keyGuard),
        callbackHandle,
        hShutdown,
        executableStr = std::move(executableStr)
    ]() mutable {
        const auto CoInitResult = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
        if (FAILED(CoInitResult) && CoInitResult != RPC_E_CHANGED_MODE) {
            return;
        }
        auto CoGuard = MakeScopeExit([CoInitResult] {
            if (CoInitResult == S_OK) {
                CoUninitialize();
            }
        });
        auto policy = getPolicy();
        if (!policy) {
            return;
        }
        auto policyGuard = MakeScopeExit([&policy] {
            policy->Release();
        });

        HANDLE handles[2] = { CreateEventW(nullptr, FALSE, FALSE, nullptr), hShutdown };
        if (!handles[0]) { return; }
        auto eventHandleGuard = MakeScopeExit([&]{ CloseHandle(handles[0]); });

        std::wstring normalizedExePath = normalizePath(executableStr.c_str());
        auto firewallStatus = CheckInboundFirewallStatus(policy, normalizedExePath);

        bool initialNotificationSent = false;
        while (ERROR_SUCCESS == RegNotifyChangeKeyValue(hKey, TRUE, REG_NOTIFY_CHANGE_NAME | REG_NOTIFY_CHANGE_LAST_SET, handles[0], TRUE)) {
            if (!initialNotificationSent) {
                initialNotificationSent = true;
                NS_DispatchToMainThread(NS_NewRunnableFunction("FirewallModified", [callbackHandle, firewallStatus]() mutable {
                    callbackHandle->Observe(nullptr, "firewall-modified", InboundStatusStr(firewallStatus));
                }), NS_DISPATCH_NORMAL);
            }

            if (WAIT_OBJECT_0 + 1 == ::WaitForMultipleObjects(2, handles, FALSE, INFINITE)) {
                break;
            }

            const auto newFirewallStatus = CheckInboundFirewallStatus(policy, normalizedExePath);
            if (firewallStatus != newFirewallStatus) {
                firewallStatus = newFirewallStatus;

                NS_DispatchToMainThread(NS_NewRunnableFunction("FirewallModified", [callbackHandle, firewallStatus]() mutable {
                    callbackHandle->Observe(nullptr, "firewall-modified", InboundStatusStr(firewallStatus));
                }), NS_DISPATCH_NORMAL);
            }
        }
    }), NS_DISPATCH_NORMAL);

    if (NS_FAILED(rv)) {
        return rv;
    }

    return NS_OK;
}

}
