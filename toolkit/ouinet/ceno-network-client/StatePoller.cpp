#include <atomic>
#include <chrono>
#include <semaphore>
#include <thread>

#include "client_lib.h"
#include "GuiWindow.h"
#include "NetworkAddressMonitor.h"
#include "NetworkStatusMonitor.h"
#include "StatePoller.h"

static std::thread poller_thread;
static std::binary_semaphore request_to_stop{1};

int unpackOuinetState(const LPARAM lParam) {
    return LOWORD(lParam);
}
bool unpackInternetState(const LPARAM lParam) {
    return HIWORD(lParam);
}

static LPARAM packOuinetAndInternetState(const int ouinetState, const bool isOnline) {
    return MAKELPARAM(static_cast<WORD>(ouinetState), static_cast<WORD>(isOnline));
}

static void work(const WPARAM connectionId, const std::chrono::time_point<std::chrono::steady_clock> ouinetStartedAt) {

    bool isOnline = network_is_online.load();

    int ouinetState = 0;
    while (true) {
        constexpr auto debounceDuration = std::chrono::milliseconds(500);
        const auto networkAddressChangedAt = network_address_changed_at.load();
        const auto now = std::chrono::steady_clock::now();
        if (
            ouinetStartedAt < networkAddressChangedAt &&
            now - networkAddressChangedAt > debounceDuration
        ) {
            if (const HWND hWnd = windowHandleForCommunicatingFromOtherThreads.load(); NULL != hWnd) {
                PostMessageW(hWnd, networkAddressChange, 0, 0);
                break;
            }
        }

        const bool wasOnline = isOnline;
        isOnline = network_is_online.load();
        if (const int newOuinetState = ouinet_client_get_client_state(); ouinetState != newOuinetState || wasOnline != isOnline) {
            ouinetState = newOuinetState;
            if (const HWND hWnd = windowHandleForCommunicatingFromOtherThreads.load(); NULL != hWnd) {
                PostMessageW(hWnd, ouinetStateChange, connectionId, packOuinetAndInternetState(ouinetState, isOnline));
            }
        }

        if (request_to_stop.try_acquire_for(std::chrono::seconds(1))) {
            request_to_stop.release();
            break;
        }
    }
}

void startStatePoller(const WPARAM connectionId, const std::chrono::time_point<std::chrono::steady_clock> ouinetStartedAt) {
    request_to_stop.acquire();
    poller_thread = std::thread(work, connectionId, ouinetStartedAt);
}

void stopStatePoller() {
    if (poller_thread.joinable()) {
        request_to_stop.release();
        poller_thread.join();
        poller_thread = std::thread();
    }
}
