#include <chrono>
#include <semaphore>
#include <thread>

#include "client_lib.h"
#include "GuiWindow.h"
#include "StatePoller.h"

static std::thread poller_thread;
static std::binary_semaphore request_to_stop{1};

static void work() {
    int state = 0;
    while (true) {
        if (const int newState = ouinet_client_get_client_state(); state != newState) {
            state = newState;
            if (const HWND hWnd = windowHandleForCommunicatingFromOtherThreads.load(); NULL != hWnd) {
                PostMessage(windowHandleForCommunicatingFromOtherThreads, ouinetStateChange, newState, 0);
            }
        }
        if (request_to_stop.try_acquire_for(std::chrono::seconds(1))) {
            break;
        }
    }
}

void startStatePoller() {
    request_to_stop.acquire();
    poller_thread = std::thread(work);
}

void stopStatePoller() {
    if (poller_thread.joinable()) {
        request_to_stop.release();
        poller_thread.join();
        poller_thread = std::thread();
    }
}
