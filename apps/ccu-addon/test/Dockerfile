# A container close enough to OpenCCU to replay the firmware's addon installation, exactly the way
# ccu-addon-howto/docs/08-testing.md describes it: busybox as /bin/sh, tclsh for the CGIs and the
# update_addon helper, the real lighttpd with the firmware's CGI and /addons rules, and a stub
# tclrega.so so the WebUI session check can be exercised without a CCU.
#
# What this container can test: the whole install / update / uninstall path, the lighttpd proxy rule
# including the WebSocket upgrade, and every CGI over HTTP. What it cannot: Tcl 8.2 (the CCU3
# firmware's interpreter - `cgi-test.sh` greps for constructs newer than that instead), the CCU3's
# chroot install, the real tclrega.so, and an actual CCU behind the backend.

FROM debian:trixie-slim

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        busybox \
        ca-certificates \
        curl \
        file \
        gcc \
        libc6-dev \
        lighttpd \
        openssl \
        pkg-config \
        procps \
        tcl \
        tcl-dev \
    && rm -rf /var/lib/apt/lists/*

# The stub ReGa: `load tclrega.so` is a bare dlopen, so the library only has to be where the dynamic
# linker looks. It answers `system.GetSessionVarStr('<sid>')` with a user name when the session id
# is listed in /tmp/valid-sids and with an empty string otherwise - which is exactly how ReGaHSS
# answers for a live and for an expired session.
COPY tclrega-stub.c /tmp/tclrega-stub.c
RUN gcc -shared -fPIC -o /usr/lib/tclrega.so /tmp/tclrega-stub.c $(pkg-config --cflags --libs tcl) \
    && rm -f /tmp/tclrega-stub.c \
    && ldconfig

# The CCU's directory layout on the writable partition, plus the symlink the firmware provides.
RUN mkdir -p /usr/local/addons /usr/local/tmp /usr/local/etc/config/rc.d \
        /usr/local/etc/config/addons/www /usr/local/etc/config/lighttpd /var/log \
    && ln -sfn /usr/local/etc/config /etc/config \
    && touch /usr/local/etc/config/hm_addons.cfg

COPY lighttpd-ccu.conf /etc/lighttpd/lighttpd-ccu.conf

# busybox last: /bin/sh becomes ash, the shell both firmwares run update_script and rc.d with, and
# start-stop-daemon, logger, od, dd, tail and wc come from the same binary - the applets the addon
# scripts call, with the busybox semantics they have on a CCU. Doing this after apt keeps the
# package manager working during the build.
RUN for applet in sh ash logger od dd tail wc; do ln -sf /usr/bin/busybox /usr/bin/$applet; done \
    && ln -sf /usr/bin/busybox /usr/sbin/start-stop-daemon

CMD ["sleep", "infinity"]
