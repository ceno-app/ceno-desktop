# How to build and package
```sh
ln -s mozconfig-windows-x86_64 mozconfig

export MOZ_SOURCE_REPO=https://gitlab.com/ceno-app/ceno-desktop
export MOZ_SOURCE_CHANGESET=$(git rev-parse HEAD)
export MOZ_CHROME_MULTILOCALE=$(< locales)

./mach bootstrap
./mach configure
./mach build
./mach package-multi-locale --locales ${MOZ_CHROME_MULTILOCALE}
./mach package
```

# zsh
On zsh `$MOZ_CHROME_MULTILOCALE` needs to be separated into separate arguments:
```
./mach package-multi-locale --locales ${=MOZ_CHROME_MULTILOCALE}
```
