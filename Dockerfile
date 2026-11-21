# Image du générateur de rtgre : interroge ADE et publie le site statique dans
# $SCHEDULE_OUTPUT_ROOT/dist, puis s'arrête. Le code reste en lecture seule.
# L'image de base est épinglée par empreinte ; Renovate la tient à jour.
FROM python:3.14.10-alpine3.24@sha256:5862d971d1f0ae26b258cefa4e893556b1d3aba81bd2ff30888704ad378bab67 AS python

FROM python AS dependencies
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1
COPY requirements.txt /tmp/requirements.txt
# Chaque paquet, dépendances transitives comprises, est vérifié par son empreinte.
RUN python -m venv --without-pip /opt/venv \
    && python -m pip --python /opt/venv/bin/python install \
        --require-hashes --only-binary=:all: --no-compile -r /tmp/requirements.txt

FROM python
LABEL org.opencontainers.image.title="rtgre" \
      org.opencontainers.image.description="Générateur du site rtgre.fr" \
      org.opencontainers.image.licenses="MIT"
# Le générateur n'installe rien à l'exécution : pip quitte l'image finale.
RUN python -m pip uninstall --yes --quiet pip \
    && mkdir -p /srv/site \
    && chown 65532:65532 /srv/site
ENV PATH=/opt/venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/src \
    SCHEDULE_OUTPUT_ROOT=/srv/site
COPY --from=dependencies /opt/venv /opt/venv
WORKDIR /app
COPY config ./config
COPY templates ./templates
COPY static ./static
COPY src ./src
USER 65532:65532
ENTRYPOINT ["python", "-m", "schedule.build"]
