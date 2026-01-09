#include <fstream>
#include "ProcessIdFile.h"

bool ProcessIdFile::write(const DWORD windowProcessId) {
    std::ofstream stream { pidFilePath};
    written = stream.good() && (stream << windowProcessId);
    return written;
}

bool ProcessIdFile::remove(std::error_code &ec) {
    if (written) {
        if (std::filesystem::remove(pidFilePath, ec)) {
            written = false;
            return true;
        }
    }
    return false;
}

ProcessIdFile::~ProcessIdFile() {
    std::error_code ec;
    remove(ec);
}

const std::filesystem::path &ProcessIdFile::getPidFilePath() const {
    return pidFilePath;
}
