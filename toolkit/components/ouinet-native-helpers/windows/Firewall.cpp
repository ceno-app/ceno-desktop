#include "nsCOMPtr.h"
#include "nsIThreadManager.h"
#include "nsThreadUtils.h"
#include "nsServiceManagerUtils.h"
#include "nsLiteralString.h"
#include "nsIObserver.h"
#include "nsIObserverService.h"
#include "nsComponentManagerUtils.h"
#include "mozilla/ScopeExit.h"
#include "nsProxyRelease.h"

#include <windows.h>
#include <netfw.h>

#include "../OuinetNativeHelpers.h"
#include "../Firewall.h"

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

static INetFwPolicy2* getPolicy() {
    INetFwPolicy2* policy = nullptr;
    CoCreateInstance(
        __uuidof(NetFwPolicy2), nullptr, CLSCTX_INPROC_SERVER,
        __uuidof(INetFwPolicy2), (void**)&policy
    );
    return policy;
}

static InboundStatus CheckInboundFirewallStatus(
    INetFwPolicy2* policy,
    const std::wstring_view normalizedExePath,
    int port,
    NET_FW_IP_PROTOCOL protocol = NET_FW_IP_PROTOCOL_UDP)
{
    long activeProfiles = 0;
    if (FAILED(policy->get_CurrentProfileTypes(&activeProfiles)) || activeProfiles == 0) {
        return InboundStatus::Unknown;
    }

    // Determine highest priority active profile (Domain > Private > Public)
    NET_FW_PROFILE_TYPE2 profileToCheck = NET_FW_PROFILE2_PUBLIC;
    if (activeProfiles & NET_FW_PROFILE2_DOMAIN) {
        profileToCheck = NET_FW_PROFILE2_DOMAIN;
    } else if (activeProfiles & NET_FW_PROFILE2_PRIVATE) {
        profileToCheck = NET_FW_PROFILE2_PRIVATE;
    }

    VARIANT_BOOL fwEnabled = VARIANT_FALSE;
    policy->get_FirewallEnabled(profileToCheck, &fwEnabled);
    if (fwEnabled == VARIANT_FALSE) {
        return InboundStatus::FirewallDisabled;
    }

    VARIANT_BOOL blockAll = VARIANT_FALSE;
    policy->get_BlockAllInboundTraffic(profileToCheck, &blockAll);

    NET_FW_ACTION defaultAction = NET_FW_ACTION_BLOCK;
    policy->get_DefaultInboundAction(profileToCheck, &defaultAction);

    INetFwRules* rules = nullptr;
    if (HRESULT hr = policy->get_Rules(&rules); FAILED(hr) || !rules) {
        return (defaultAction == NET_FW_ACTION_ALLOW) ? InboundStatus::AllowedByDefault : InboundStatus::BlockedByDefault;
    }
    auto rulesGuard = MakeScopeExit([&rules] { rules->Release(); });

    bool hasAllowForPort = false;
    bool hasBlockForPort = false;

    IUnknown* pUnk = nullptr;
    if (HRESULT hr = rules->get__NewEnum(&pUnk); FAILED(hr) || !pUnk) {
        return InboundStatus::Unknown;
    }
    auto unkGuard = MakeScopeExit([&pUnk] { pUnk->Release(); });

    IEnumVARIANT* pEnum = nullptr;
    if (HRESULT hr = pUnk->QueryInterface(IID_IEnumVARIANT, (void**)&pEnum); FAILED(hr) || !pEnum) {
        return InboundStatus::Unknown;
    }
    auto enumGuard = MakeScopeExit([&pEnum] { pEnum->Release(); });

    VARIANT var;
    VariantInit(&var);
    while (S_OK == pEnum->Next(1, &var, nullptr)) {
        if (V_VT(&var) != VT_DISPATCH || !V_DISPATCH(&var)) {
            VariantClear(&var);
            continue;
        }

        INetFwRule* rule = nullptr;
        HRESULT hr = V_DISPATCH(&var)->QueryInterface(IID_INetFwRule, (void**)&rule);
        VariantClear(&var);
        if (FAILED(hr) || !rule) {
            continue;
        }
        auto ruleGuard = MakeScopeExit([&rule] { rule->Release(); });

        NET_FW_RULE_DIRECTION dir = NET_FW_RULE_DIR_OUT;
        if (FAILED(rule->get_Direction(&dir)) || dir != NET_FW_RULE_DIR_IN) {
            continue;
        }

        VARIANT_BOOL enabled = VARIANT_FALSE;
        if (rule->get_Enabled(&enabled); enabled != VARIANT_TRUE) {
            continue;
        }

        if (long ruleProfiles = 0; FAILED(rule->get_Profiles(&ruleProfiles)) || (ruleProfiles & activeProfiles) == 0) {
            continue;
        }

        static_assert(sizeof(NET_FW_IP_PROTOCOL) == sizeof(LONG), "Protocol enum size mismatch");
        if (NET_FW_IP_PROTOCOL ruleProtocol = NET_FW_IP_PROTOCOL_ANY;
            FAILED(rule->get_Protocol(reinterpret_cast<LONG*>(&ruleProtocol))) ||
            (ruleProtocol != protocol && ruleProtocol != NET_FW_IP_PROTOCOL_ANY)) {
            continue;
        }

        BSTR bstrApp = nullptr;
        if (hr = rule->get_ApplicationName(&bstrApp); FAILED(hr) || !bstrApp) {
            continue;
        }
        auto appGuard = MakeScopeExit([&bstrApp] { SysFreeString(bstrApp); });

        if (normalizePath(bstrApp) != normalizedExePath) {
            continue;
        }

        BSTR bstrPorts = nullptr;
        if (hr = rule->get_LocalPorts(&bstrPorts); FAILED(hr) || !bstrPorts) {
            continue;
        }
        auto portsGuard = MakeScopeExit([&bstrPorts] { SysFreeString(bstrPorts); });

        bool portMatches = false;

        // Helper to parse int from wstring_view without allocation
        const auto wtoi_view = [](std::wstring_view sv) -> int {
            int value = 0;
            for (wchar_t ch : sv) {
                if (ch < L'0' || ch > L'9') break;
                value = value * 10 + (ch - L'0');
            }
            return value;
        };
        std::wstring_view portsView(
            bstrPorts ? bstrPorts : L"",
            bstrPorts ? SysStringLen(bstrPorts) : 0);

        if (portsView == L"*") {
            portMatches = true;
        } else {
            while (!portsView.empty()) {
                const auto comma = portsView.find(L',');
                std::wstring_view token = portsView.substr(0, comma);

                // Check for range ("49152-65535")
                if (const auto dash = token.find(L'-'); dash != std::wstring_view::npos) {
                    const int minPort = wtoi_view(token.substr(0, dash));
                    const int maxPort = wtoi_view(token.substr(dash + 1));
                    if (port >= minPort && port <= maxPort) {
                        portMatches = true;
                        break;
                    }
                } else {
                    // Single port
                    if (wtoi_view(token) == port) {
                        portMatches = true;
                        break;
                    }
                }
                if (comma == std::wstring_view::npos) break;
                portsView.remove_prefix(comma + 1);
            }
        }

        if (!portMatches) continue;

        if (NET_FW_ACTION action = NET_FW_ACTION_BLOCK; SUCCEEDED(rule->get_Action(&action))) {
            if (action == NET_FW_ACTION_ALLOW) {
                hasAllowForPort = true;
            } else if (action == NET_FW_ACTION_BLOCK) {
                hasBlockForPort = true;
            }
        }
    }
    if (hasBlockForPort) {
        return InboundStatus::Blocked;
    }
    if (hasAllowForPort) {
        return InboundStatus::Allowed;
    }
    if (blockAll == VARIANT_TRUE) {
        return InboundStatus::BlockedByDefault;
    }
    return defaultAction == NET_FW_ACTION_BLOCK ? InboundStatus::BlockedByDefault : InboundStatus::AllowedByDefault;
}

NS_IMETHODIMP
OuinetNativeHelpers::ModifyFirewallMonitorPort(const int32_t port) {
    if (!portUpdateEvent || !firewallMonitorThread) return NS_ERROR_NOT_INITIALIZED;
    const int32_t oldPort = udpPort.exchange(port, std::memory_order::relaxed);
    if (oldPort != port)
        SetEvent(portUpdateEvent);
    return NS_OK;
}

NS_IMETHODIMP
OuinetNativeHelpers::MonitorFirewall(const nsAString &executable, nsIObserver *callback, const int32_t port) {
    if (!callback) return NS_ERROR_INVALID_POINTER;
    if (!shutdownEvent || !portUpdateEvent) return NS_ERROR_NOT_INITIALIZED;
    if (firewallMonitorThread) return NS_ERROR_ALREADY_INITIALIZED;

    udpPort.store(port, std::memory_order::relaxed);
    const nsresult rv1 = NS_NewNamedThread("FirewallMonitor", getter_AddRefs(firewallMonitorThread));
    NS_ENSURE_SUCCESS(rv1, rv1);

    HKEY hKey;
    if (ERROR_SUCCESS != RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"SYSTEM\\CurrentControlSet\\Services\\SharedAccess\\Parameters\\FirewallPolicy", 0, KEY_NOTIFY | KEY_READ, &hKey)) {
        return NS_ERROR_FAILURE;
    }
    auto keyGuard = MakeScopeExit([&hKey]{ RegCloseKey(hKey); });

    // nsAString may not be null terminated.
    const std::wstring executableStr {
        reinterpret_cast<const wchar_t *>(executable.BeginReading()),
        executable.Length()
    };

    nsMainThreadPtrHandle<nsIObserver> callbackHandle(new nsMainThreadPtrHolder<nsIObserver>("OuinetFirewallCallback", callback));
    const auto rv = firewallMonitorThread->Dispatch(NS_NewRunnableFunction("FirewallMonitor", [
        hKey, keyGuard = std::move(keyGuard),
        callbackHandle,
        shutdownEvent = shutdownEvent,
        portUpdateEvent = portUpdateEvent,
        executableStr = std::move(executableStr),
        &udpPort = this->udpPort
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

        HANDLE handles[] = { shutdownEvent, CreateEventW(nullptr, FALSE, FALSE, nullptr), portUpdateEvent };
        if (!handles[1]) { return; }
        auto eventHandleGuard = MakeScopeExit([&]{ CloseHandle(handles[1]); });

        std::wstring normalizedExePath = normalizePath(executableStr.c_str());
        InboundStatus firewallStatus;

        bool initialNotificationSent = false;
        while (ERROR_SUCCESS == RegNotifyChangeKeyValue(hKey, TRUE, REG_NOTIFY_CHANGE_NAME | REG_NOTIFY_CHANGE_LAST_SET, handles[1], TRUE)) {
            if (!initialNotificationSent) {
                initialNotificationSent = true;
                firewallStatus = CheckInboundFirewallStatus(policy, normalizedExePath, udpPort.load(std::memory_order::relaxed));
                NS_DispatchToMainThread(NS_NewRunnableFunction("FirewallModified", [callbackHandle, firewallStatus]() mutable {
                    callbackHandle->Observe(nullptr, "firewall-modified", InboundStatusStr(firewallStatus));
                }), NS_DISPATCH_NORMAL);
            }

            if (WAIT_OBJECT_0 == ::WaitForMultipleObjects(3, handles, FALSE, INFINITE)) {
                break;
            }

            const auto newFirewallStatus = CheckInboundFirewallStatus(policy, normalizedExePath, udpPort.load(std::memory_order::relaxed));
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
