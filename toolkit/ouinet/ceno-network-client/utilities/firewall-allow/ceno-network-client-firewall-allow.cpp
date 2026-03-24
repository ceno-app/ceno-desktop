#include <format>
#include <utility>
#include <vector>

#include <windows.h>
#include <netfw.h>
#include <comdef.h>
#include <shellapi.h>

#include "admin.h"
#include "paths.h"

template<class F>
class Defer {
    F _on_destruct;
public:
    Defer(F on_destruct): _on_destruct(std::move(on_destruct)) { }
    ~Defer() { _on_destruct(); }
};

static void removeRulesForExecutable(INetFwRules* pRules, const wchar_t *applicationPath) {
    IUnknown *pUnknown = nullptr;
    HRESULT hr = pRules->get__NewEnum(&pUnknown);
    if (FAILED(hr)) return;

    IEnumVARIANT *pEnum = nullptr;
    hr = pUnknown->QueryInterface(IID_IEnumVARIANT, (void**)&pEnum);
    pUnknown->Release();
    if (FAILED(hr)) return;

    std::vector<BSTR> rulesToRemove;
    rulesToRemove.reserve(8);
    VARIANT var;
    while (pEnum->Next(1, &var, nullptr) == S_OK) {
        if (V_VT(&var) == VT_DISPATCH) {
            INetFwRule* pRule = nullptr;
            if (SUCCEEDED(V_DISPATCH(&var)->QueryInterface(IID_INetFwRule, (void**)&pRule))) {
                BSTR bstrAppName = nullptr;
                if (SUCCEEDED(pRule->get_ApplicationName(&bstrAppName)) && bstrAppName) {
                    if (normalizePath(bstrAppName) == applicationPath) {
                        BSTR bstrName = nullptr;
                        if (SUCCEEDED(pRule->get_Name(&bstrName)) && bstrName) {
                            rulesToRemove.push_back(bstrName);
                        }
                    }
                    SysFreeString(bstrAppName);
                }
                pRule->Release();
            }
        }
        VariantClear(&var);
    }
    pEnum->Release();

    // Now remove collected rules
    for (const auto& name : rulesToRemove) {
        pRules->Remove(name);
        SysFreeString(name);
    }
}

static bool addFirewallRule(
    const wchar_t *applicationPath,
    INetFwRules *pRules,
    const wchar_t *ruleName, const wchar_t *localPorts,
    const long activeProfiles,
    const NET_FW_IP_PROTOCOL protocol)
{
    // Create new rule
    INetFwRule* pRule = nullptr;
    HRESULT hr = CoCreateInstance(__uuidof(NetFwRule), nullptr,
                          CLSCTX_INPROC_SERVER, IID_INetFwRule,
                          reinterpret_cast<void**>(&pRule));
    if (FAILED(hr)) return false;

    const auto ruleNameFull = std::format(L"{} ({})", ruleName, applicationPath);

    // Configure rule properties
    pRule->put_Name(_bstr_t(ruleNameFull.c_str()));
    pRule->put_Description(_bstr_t(L"Allow incoming connections for Ceno Network Client"));
    pRule->put_Direction(NET_FW_RULE_DIR_IN);
    pRule->put_Action(NET_FW_ACTION_ALLOW);
    pRule->put_Protocol(protocol);
    pRule->put_LocalPorts(_bstr_t(localPorts));
    pRule->put_Profiles(activeProfiles);
    pRule->put_Enabled(VARIANT_TRUE);

    pRule->put_ApplicationName(_bstr_t(applicationPath));

    // Add rule to firewall
    hr = pRules->Add(pRule);

    pRule->Release();
    return SUCCEEDED(hr);
}

int APIENTRY wWinMain(HINSTANCE /*hInstance*/, HINSTANCE, LPWSTR /*arguments*/, int /*nCmdShow*/) {
    const auto myPath = getMyPath();
    if (!myPath.has_value()) {
        MessageBoxW(NULL, L"Failed to get program path", L"Ceno Network Client Firewall", MB_OK | MB_ICONERROR);
        return 1;
    }
    switch (ensureRunningAsAdmin(myPath.value().c_str())) {
        case AdminStatus::AlreadyAdmin: break;
        case AdminStatus::ElevatedToAdmin: return 0;
        case AdminStatus::Failed: return 1;
    }

    HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(hr)) return 1;
    auto coGuard = Defer([]() { CoUninitialize(); });

    // Create policy manager
    INetFwPolicy2* policy = nullptr;
    hr = CoCreateInstance(__uuidof(NetFwPolicy2), nullptr, CLSCTX_INPROC_SERVER, IID_INetFwPolicy2, reinterpret_cast<void**>(&policy));
    if (FAILED(hr)) return 1;
    auto policyGuard = Defer([&]() { if (policy) policy->Release(); });

    // Get active profiles (bitmask of NET_FW_PROFILE_TYPE2)
    long activeProfiles = 0;
    policy->get_CurrentProfileTypes(&activeProfiles);
    if (0 == activeProfiles) {
        MessageBoxW(NULL, L"Failed to get Active Firewall Profile", L"Ceno Network Client Firewall", MB_OK | MB_ICONERROR);
        return 1;
    }

    // Get rules collection
    INetFwRules* rules = nullptr;
    hr = policy->get_Rules(&rules);
    if (FAILED(hr) || !rules) return 1;
    auto rulesGuard = Defer([&]() { rules->Release(); });

    const auto networkClientPath = getNetworkClientPath(myPath.value().c_str());
    removeRulesForExecutable(rules, networkClientPath.c_str());
    if (!addFirewallRule(networkClientPath.c_str(), rules, L"Ceno Network Client UDP Multiplexer", L"28729", activeProfiles, NET_FW_IP_PROTOCOL_UDP)) {
        MessageBoxW(NULL, L"Failed to Add Firewall Rule", L"Ceno Network Client Firewall", MB_OK | MB_ICONERROR);
        return 1;
    }
    if (!addFirewallRule(networkClientPath.c_str(), rules, L"Ceno Network Client UDP Multiplexer fallback", L"49152-65535", activeProfiles, NET_FW_IP_PROTOCOL_UDP)) {
        MessageBoxW(NULL, L"Failed to Add Firewall Rule", L"Ceno Network Client Firewall", MB_OK | MB_ICONERROR);
        return 1;
    }
    return 0;
}
