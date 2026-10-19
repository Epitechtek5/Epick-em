FROM liquibase/liquibase:4.31
COPY changelog/ /liquibase/changelog/
ENV LIQUIBASE_COMMAND_CHANGELOG_FILE=changelog/db.changelog-master.yaml
CMD ["update"]
