#include <poll.h>
#include <signal.h>

#include "nsProxyRelease.h"
#include "../OuinetNativeHelpers.h"

namespace mozilla {

static bool CheckProcessImageName(const int32_t pid) {
  char procPath[64];
  snprintf(procPath, sizeof(procPath), "/proc/%d/exe", pid);

  char exePath[PATH_MAX];
  const ssize_t len = readlink(procPath, exePath, sizeof(exePath) - 1);
  if (len == -1) {
    return false;
  }
  exePath[len] = '\0';

  const char* base = std::strrchr(exePath, '/');
  const char* name = base ? base + 1 : exePath;
  return std::strcmp(name, "client") == 0;
}

NS_IMETHODIMP
OuinetNativeHelpers::EndNetworkClientProcess(const int32_t pid) {
  if (!CheckProcessImageName(pid)) {
    return NS_ERROR_INVALID_ARG;
  }
  return kill(pid, SIGTERM) == 0 ? NS_OK : NS_ERROR_FAILURE;
}

#if !defined(__NR_pidfd_open) && (defined(__x86_64__) || defined(__aarch64__) || defined(__arm__) || defined(__i386__) || defined(__riscv))
#define __NR_pidfd_open 434
#endif

NS_IMETHODIMP
OuinetNativeHelpers::MonitorNetworkClientProcess(const int32_t pid, nsIObserver *callback) {
  if (!callback) return NS_ERROR_INVALID_POINTER;
  if (shutdownEvent[0] == -1 ) return NS_ERROR_NOT_INITIALIZED;
  if (!clientMonitorThread) {
    nsresult rv = NS_NewNamedThread("MonitorProcess", getter_AddRefs(clientMonitorThread));
    NS_ENSURE_SUCCESS(rv, rv);
  }

  if (!CheckProcessImageName(pid)) {
    return NS_ERROR_INVALID_ARG;
  }
  const int pidfd = syscall(__NR_pidfd_open, static_cast<pid_t>(pid), 0);
  if (pidfd == -1) {
    return NS_ERROR_INVALID_ARG;
  }

  const int shutdownPipe = shutdownEvent[0];

  nsMainThreadPtrHandle<nsIObserver> callbackHandle(new nsMainThreadPtrHolder<nsIObserver>("OuinetMonitorCallback", callback));

  nsresult rv = clientMonitorThread->Dispatch(NS_NewRunnableFunction("ProcessWait", [
      pidfd,
      shutdownPipe,
      callbackHandle
  ]() mutable {
    pollfd fds[2] {
      { .fd = pidfd, .events = POLLIN, },
      { .fd = shutdownPipe, .events = POLLIN, },
    };
    const int ready = poll(fds, 2, -1);
    close(pidfd);
    const bool processExited = ready > 0 && fds[0].revents & POLLIN;
    if (processExited) {
      // No way to reliably obtain exit code of process orphaned by pid 1
      constexpr int exitCode = 0;
      nsAutoString exitCodeStr;
      exitCodeStr.AppendInt(static_cast<int32_t>(exitCode));
      NS_DispatchToMainThread(NS_NewRunnableFunction("ProcessExit", [
        callbackHandle, exitCodeStr = std::move(exitCodeStr)
      ]() mutable {
        callbackHandle->Observe(nullptr, "process-exited", exitCodeStr.get());
      }), NS_DISPATCH_NORMAL);
    }
  }), NS_DISPATCH_NORMAL);

  if (NS_FAILED(rv)) {
    close(pidfd);
    return rv;
  }

  return NS_OK;
}

}
