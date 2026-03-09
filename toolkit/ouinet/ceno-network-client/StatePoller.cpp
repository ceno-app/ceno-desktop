#include <atomic>
#include <chrono>
#include <thread>

#include "client_lib.h"
#include "GuiWindow.h"
#include "StatePoller.h"

static std::thread poller_thread;
static std::atomic_flag keep_going;

static void work() {
    int state = 0;
    while (keep_going.test()) {
        if (const int newState = ouinet_client_get_client_state(); state != newState) {
            state = newState;
            if (const HWND hWnd = windowHandleForCommunicatingFromOtherThreads.load(); NULL != hWnd) {
                PostMessage(windowHandleForCommunicatingFromOtherThreads, ouinetStateChange, newState, 0);
            }
        }
        using namespace std::chrono_literals;
        std::this_thread::sleep_for(1s);
    }
}

void startStatePoller() {
    keep_going.test_and_set();
    poller_thread = std::thread(work);
}

void stopStatePoller() {
    if (poller_thread.joinable()) {
        keep_going.clear();
        poller_thread.detach();
    }
}
