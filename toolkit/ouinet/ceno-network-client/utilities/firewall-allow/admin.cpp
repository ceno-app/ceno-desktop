#include <windows.h>
#include <shellapi.h>

#include "admin.h"

static bool isRunningAsAdmin() {
    BOOL isAdmin = FALSE;
    PSID administratorsGroup = nullptr;

    SID_IDENTIFIER_AUTHORITY ntAuthority = SECURITY_NT_AUTHORITY;
    if (AllocateAndInitializeSid(&ntAuthority, 2, SECURITY_BUILTIN_DOMAIN_RID, DOMAIN_ALIAS_RID_ADMINS, 0, 0, 0, 0, 0, 0, &administratorsGroup)) {
        CheckTokenMembership(nullptr, administratorsGroup, &isAdmin);
        FreeSid(administratorsGroup);
    }
    return isAdmin;
}

static bool elevateSelf(const wchar_t *selfExecutable) {
    SHELLEXECUTEINFOW sei = {
        .cbSize = sizeof(sei),
        .fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NO_CONSOLE,
        .hwnd = nullptr,
        .lpVerb = L"runas",
        .lpFile = selfExecutable,
        .nShow = SW_NORMAL,
    };
    if (!ShellExecuteExW(&sei) || !sei.hProcess) return false;

    // Block until elevated process exits
    WaitForSingleObject(sei.hProcess, INFINITE);

    DWORD exitCode = 1;
    GetExitCodeProcess(sei.hProcess, &exitCode);
    CloseHandle(sei.hProcess);

    return exitCode == 0;
}

AdminStatus ensureRunningAsAdmin(const wchar_t *selfExecutable) {
    if (isRunningAsAdmin())
        return AdminStatus::AlreadyAdmin;
    if (elevateSelf(selfExecutable))
        return AdminStatus::ElevatedToAdmin;
    return AdminStatus::Failed;
}
