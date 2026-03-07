#include <atomic>
#include <chrono>
#include <thread>

#include "client_lib.h"
#include "GuiWindow.h"
#include "StatePoller.h"

static std::thread thread;
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
    thread = std::thread(work);
}

void stopStatePoller() {
    keep_going.clear();
    thread.detach();
}
