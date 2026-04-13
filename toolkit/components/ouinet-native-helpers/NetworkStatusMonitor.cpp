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

#include <winsock2.h>
#include <windows.h>
#include <netlistmgr.h>
#include <combaseapi.h>
#include <wrl/client.h>

#include "OuinetNativeHelpers.h"

namespace mozilla {

class InternetEventSink : public INetworkListManagerEvents {
    ULONG ref = 1;
    virtual ~InternetEventSink() = default;
    nsMainThreadPtrHandle<nsIObserver> callbackHandle;
public:
    InternetEventSink(nsMainThreadPtrHandle<nsIObserver> callbackHandle): callbackHandle(callbackHandle) {}

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
        const bool isOnline = (connectivity & NLM_CONNECTIVITY_IPV4_INTERNET) ||
                            (connectivity & NLM_CONNECTIVITY_IPV6_INTERNET);
        NS_DispatchToMainThread(NS_NewRunnableFunction("NetworkStatusModified", [callbackHandle = callbackHandle, isOnline]() {
            callbackHandle->Observe(nullptr, "network-status-changed", isOnline ? u"Online" : u"Offline");
        }), NS_DISPATCH_NORMAL);
        return S_OK;
    }
};
    
NS_IMETHODIMP
OuinetNativeHelpers::MonitorNetworkStatus(nsIObserver *callback) {
    if (!callback) return NS_ERROR_INVALID_POINTER;
    if (!shutdownEvent) return NS_ERROR_NOT_INITIALIZED;
    if (networkStatusMonitorThread) return NS_ERROR_ALREADY_INITIALIZED;

    const nsresult rv1 = NS_NewNamedThread("NetwStatusMon", getter_AddRefs(networkStatusMonitorThread));
    NS_ENSURE_SUCCESS(rv1, rv1);

    nsMainThreadPtrHandle<nsIObserver> callbackHandle(new nsMainThreadPtrHolder<nsIObserver>("NetworkStatusCb", callback));
   
    const auto rv = networkStatusMonitorThread->Dispatch(NS_NewRunnableFunction("NetwStatusMon", [
        callbackHandle,
        shutdownEvent = shutdownEvent
    ]() mutable {
        const auto CoInitResult = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
        if (FAILED(CoInitResult) && CoInitResult != RPC_E_CHANGED_MODE) {
            return;
        }
        auto CoGuard = MakeScopeExit([CoInitResult] {
            if (CoInitResult == S_OK) {
                CoUninitialize();
            }
        });

        Microsoft::WRL::ComPtr<INetworkListManager> nlm;
        Microsoft::WRL::ComPtr<IConnectionPointContainer> cpc;
        Microsoft::WRL::ComPtr<IConnectionPoint> connPoint;

        HRESULT hr = CoCreateInstance(CLSID_NetworkListManager, nullptr, CLSCTX_ALL, IID_PPV_ARGS(&nlm));
        if (FAILED(hr)) return;

        hr = nlm.As(&cpc); // QueryInterface shorthand
        if (FAILED(hr)) return;

        hr = cpc->FindConnectionPoint(IID_INetworkListManagerEvents, connPoint.GetAddressOf());
        if (FAILED(hr)) return;

        InternetEventSink *sink = new(std::nothrow) InternetEventSink(callbackHandle);
        if (!sink) return;

        DWORD cookie = 0;
        hr = connPoint->Advise(sink, &cookie);
        sink->Release();

        if (FAILED(hr)) return;

        auto connectionGuard = MakeScopeExit([&]() {
            if (cookie != 0 && connPoint) {
                connPoint->Unadvise(cookie);
            }
        });

        NLM_CONNECTIVITY initial = {};
        if (SUCCEEDED(nlm->GetConnectivity(&initial))) {
            const bool isOnline = (initial & NLM_CONNECTIVITY_IPV4_INTERNET) || (initial & NLM_CONNECTIVITY_IPV6_INTERNET);
            NS_DispatchToMainThread(NS_NewRunnableFunction("NetworkStatusModified", [callbackHandle, isOnline]() {
                callbackHandle->Observe(nullptr, "network-status-changed", isOnline ? u"Online" : u"Offline");
            }), NS_DISPATCH_NORMAL);
        }

        ::WaitForSingleObject(shutdownEvent, INFINITE);
    }), NS_DISPATCH_NORMAL);

    if (NS_FAILED(rv)) return rv;
    return NS_OK;
}

} // namespace mozilla
