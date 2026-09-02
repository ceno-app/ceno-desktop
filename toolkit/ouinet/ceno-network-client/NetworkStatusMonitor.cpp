#include <atomic>
#include <chrono>
#include <semaphore>
#include <thread>

#include <winsock2.h>
#include <windows.h>
#include <ws2ipdef.h>
#include <iphlpapi.h>
#include <netlistmgr.h>
#include <combaseapi.h>
#include <wrl/client.h>

#include "NetworkStatusMonitor.h"

std::atomic_bool network_is_online;

static IConnectionPoint *conn_point = nullptr;
static DWORD cookie = 0;
static bool com_was_initialized = false;

class InternetEventSink : public INetworkListManagerEvents {
    ULONG ref = 1;

    virtual ~InternetEventSink() = default;

public:
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void **ppv) override {
        if (riid == IID_IUnknown || riid == IID_INetworkListManagerEvents) {
            *ppv = this;
            AddRef();
            return S_OK;
        }
        return E_NOINTERFACE;
    }

    ULONG STDMETHODCALLTYPE AddRef() override { return ++ref; }

    ULONG STDMETHODCALLTYPE Release() override {
        if (--ref == 0)
            delete this;
        return ref;
    }

    HRESULT STDMETHODCALLTYPE ConnectivityChanged(const NLM_CONNECTIVITY connectivity) override {
        const bool has_internet = (connectivity & NLM_CONNECTIVITY_IPV4_INTERNET) ||
                                  (connectivity & NLM_CONNECTIVITY_IPV6_INTERNET);
        network_is_online = has_internet;
        return S_OK;
    }
};

bool startNetworkStatusMonitor() {
    if (conn_point != nullptr) {
        return false;
    }
    // Initialize COM on this thread (STA)
    // WARNING: With STA, this thread MUST NOT EXIT until stopNetworkStatusMonitor is called,
    // and this thread MUST have a message pump (GetMessage/DispatchMessage) if it's not the GUI thread.
    HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

    if (FAILED(hr)) {
        return false; // RPC_E_CHANGED_MODE means already initialized with different model
    }

    // Remember to uninitialize later if we succeeded here
    com_was_initialized = (hr == S_OK); // S_OK means we actually initialized it

    using Microsoft::WRL::ComPtr;
    ComPtr<INetworkListManager> nlm;
    ComPtr<IConnectionPointContainer> cpc;
    ComPtr<IConnectionPoint> connPoint;

    hr = CoCreateInstance(CLSID_NetworkListManager, nullptr, CLSCTX_ALL, IID_PPV_ARGS(&nlm));
    if (FAILED(hr)) return false;

    // Get initial state
    NLM_CONNECTIVITY initial = {};
    if (SUCCEEDED(nlm->GetConnectivity(&initial))) {
        const bool online = (initial & NLM_CONNECTIVITY_IPV4_INTERNET) ||
                            (initial & NLM_CONNECTIVITY_IPV6_INTERNET);
        network_is_online.store(online);
    }

    hr = nlm.As(&cpc); // QueryInterface shorthand
    if (FAILED(hr)) return false;

    hr = cpc->FindConnectionPoint(IID_INetworkListManagerEvents, connPoint.GetAddressOf());
    if (FAILED(hr)) return false;

    InternetEventSink *sink = new(std::nothrow) InternetEventSink();
    if (!sink) return false;

    DWORD cookie_ = 0;
    hr = connPoint->Advise(sink, &cookie_);
    // Release ref regardless of Advise() success
    sink->Release();

    if (FAILED(hr)) return false;

    // transfer to globals
    cookie = cookie_;
    conn_point = connPoint.Detach();
    return true;
}

void stopNetworkStatusMonitor() {
    if (conn_point != nullptr) {
        if (cookie != 0) {
            conn_point->Unadvise(cookie);
        }
        conn_point->Release();
    }
    conn_point = nullptr;
    cookie = 0;

    if (com_was_initialized) {
        CoUninitialize();
        com_was_initialized = false;
    }
}
