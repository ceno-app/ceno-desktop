include $(DEPTH)/.mozconfig-client-mk

SIGNING_MODE ?= none

SIGN_CALL := $(PYTHON3) $(topsrcdir)/build/codesign.py \
--cert "$(DIST)/certs/private.pfx" \
--timestamp "http://timestamp.digicert.com"

ifeq ($(BASE_BROWSER_VERSION),dev-build)
  SIGN_CALL += --auto-generate-cert
endif

# @TODO: once we are not self signed --allow-untrusted only for dev builds
# ifeq ($(BASE_BROWSER_VERSION),dev-build)
  SIGN_CALL += --allow-untrusted
# endif

ifeq ($(SIGNING_MODE),airgap)
  SIGN_CALL += --airgap "$(DIST)/airgap"
else ifeq ($(SIGNING_MODE),none)
  SIGN_CALL := echo "Skipping code signing"
else ifeq ($(SIGNING_MODE),autosign)
  SIGN_CALL += --auto-generate-cert
else
  $(error "Unknown SIGNING_MODE '$(SIGNING_MODE)', allowed values autosign, airgap or none")
endif
