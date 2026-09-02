#pragma once

enum class AdminStatus {
    AlreadyAdmin,
    ElevatedToAdmin,
    Failed
};
AdminStatus ensureRunningAsAdmin(const wchar_t *selfExecutable);
