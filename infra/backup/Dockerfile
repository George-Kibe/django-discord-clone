# Nightly encrypted PostgreSQL backups to S3-compatible storage (docs/DEPLOYMENT.md §6).
FROM rclone/rclone:1.75 AS rclone

# Same major as the database so pg_dump/pg_restore are compatible.
FROM postgres:18.6
RUN apt-get update \
 && apt-get install -y --no-install-recommends age curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=rclone /usr/local/bin/rclone /usr/local/bin/rclone
# gosu (the postgres entrypoint's privilege drop) is unused here: we run as postgres directly.
RUN rm -f /usr/local/bin/gosu
COPY --chmod=755 backup.sh restore.sh scheduler.sh /usr/local/bin/
USER postgres
WORKDIR /tmp
ENTRYPOINT ["scheduler.sh"]
