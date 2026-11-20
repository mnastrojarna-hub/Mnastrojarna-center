#!/bin/sh
# PHP z obrazu Dockeru místo místního `php` – pro zkoušky úložiště sdílení na starém PHP hostingu (výchozí PHP 5.6).
# Použití:  MN_SHARE_PHP=scripts/php-docker.sh npx vitest run src/cad/share-php.test.ts
#           scripts/php-docker.sh -l public/cad/share/store.php
# Síť hostitele (php -S 127.0.0.1:<port> je vidět zvenku), /tmp a /home na stejných cestách (dočasné složky testů,
# repozitář), proměnné MN_SHARE_* se předají. --init: ukončení klienta (SIGTERM) ukončí i server v kontejneru.
# Obraz: MN_PHP_IMAGE (výchozí php:5.6-cli; když Docker Hub odmítá, jde stáhnout mirror.gcr.io/library/php:5.6-cli
# a označit `docker tag mirror.gcr.io/library/php:5.6-cli php:5.6-cli`).
IMG=${MN_PHP_IMAGE:-php:5.6-cli}
ENVS=""
for v in $(env | sed -n 's/^\(MN_SHARE_[A-Za-z0-9_]*\)=.*/\1/p'); do
  [ "$v" = MN_SHARE_PHP ] || ENVS="$ENVS -e $v"
done
# shellcheck disable=SC2086
exec docker run --rm --init --network host -v /tmp:/tmp -v /home:/home -w "$PWD" $ENVS "$IMG" php "$@"
