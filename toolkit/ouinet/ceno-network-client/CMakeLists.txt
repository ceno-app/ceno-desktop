# Ceno Network Client has 2 build systems
# CMake and moz.build
# moz.build is used as part of Ceno Browser build process
# This CMakeLists.txt is here to allow building it separately,
# for testing and debugging purposes

cmake_minimum_required(VERSION 4.0)
project(ceno-network-client)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(CMAKE_VERBOSE_MAKEFILE=ON)
add_definitions(
    -DNTDDI_VERSION=0x0A000000
    -DWINVER=0x0A00
    -D_WIN32_WINNT=0x0A00
    -DWINAPI_FAMILY=WINAPI_FAMILY_DESKTOP_APP
    -DUNICODE
    -D_UNICODE
    -DWIN32=1
    -DWIN32_LEAN_AND_MEAN=1
    -D_WINDOWS=1
    -DWIN32_EXECUTABLE=1
)

add_executable(ceno-network-client WIN32
        app.rc
        ArgumentsConverter.cpp
        ArgumentsConverter.h
        ErrorUtils.cpp
        ErrorUtils.h
        GuiWindow.cpp
        GuiWindow.h
        Resource.h
        ceno-network-client.cpp
        ceno.ico
        cenogray.ico
        StatePoller.cpp
        StatePoller.h
        NetworkStatusMonitor.cpp
        NetworkStatusMonitor.h
        NetworkAddressMonitor.cpp
        NetworkAddressMonitor.h
)

add_library(MinGWLibClient SHARED IMPORTED)
set_target_properties(MinGWLibClient PROPERTIES
        IMPORTED_LOCATION
            "${CMAKE_CURRENT_LIST_DIR}/../../../obj-x86_64-w64-mingw32/dist/bin/Ouinet/libclient_lib.dll"
        IMPORTED_IMPLIB
            "${CMAKE_CURRENT_LIST_DIR}/../../../obj-x86_64-w64-mingw32/dist/bin/Ouinet/libclient_lib.lib"
        INTERFACE_INCLUDE_DIRECTORIES
            "${CMAKE_CURRENT_LIST_DIR}/../../../obj-x86_64-w64-mingw32/dist/bin/Ouinet/"
)

# Ouinet is shipped as .dll and .a library files.
# .lib is needed here. It can be generated from .dll using
# gendef (mingw64-w64-tools package) and lib.exe from MSVC Build Tools:

# $ gendef libclient_lib.dll
# * [libclient_lib.dll] Found PE+ image
#
# $ ~/.mozbuild/vs/VC/Tools/MSVC/14.39.33519/bin/Hostx64/x64/lib.exe /def:libclient_lib.def /out:libclient_lib.lib /machine:x64
# Microsoft (R) Library Manager Version 14.39.33519.0
# Copyright (C) Microsoft Corporation.  All rights reserved.
#
# Creating library libclient_lib.lib and object libclient_lib.exp

if(MSVC)
    target_link_options(ceno-network-client PRIVATE "/MANIFEST:NO")
else()
    # No exceptions to match compile options in moz.build,
    # moz.build disabled exceptions by default
    target_compile_options(ceno-network-client PUBLIC -municode -fno-exceptions)
    target_link_options(ceno-network-client PUBLIC -municode)
endif()
target_link_libraries(ceno-network-client comctl32 iphlpapi
    MinGWLibClient
)

# uncomment to link vcredist statically
# set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded")
