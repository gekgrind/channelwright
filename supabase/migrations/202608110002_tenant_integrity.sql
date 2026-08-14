-- Cross-record tenant integrity for the original workflow schema. Forward-only.

alter table channelwright.channel_concept_versions
  add constraint concept_versions_id_channel_unique unique (id, channel_id);

alter table channelwright.concept_viability_reports
  add constraint concept_viability_id_channel_concept_unique unique (id, channel_id, concept_version_id);

alter table channelwright.workflow_runs
  add constraint workflow_runs_id_owner_unique unique (id, owner_id);

alter table channelwright.agent_runs
  add constraint agent_runs_id_owner_unique unique (id, owner_id);

alter table channelwright.script_versions
  add constraint script_versions_id_video_unique unique (id, video_project_id);

alter table channelwright.concept_research_reports
  add constraint concept_research_version_channel_fk
  foreign key (concept_version_id, channel_id)
  references channelwright.channel_concept_versions(id, channel_id) on delete cascade;

alter table channelwright.concept_viability_reports
  add constraint concept_viability_version_channel_fk
  foreign key (concept_version_id, channel_id)
  references channelwright.channel_concept_versions(id, channel_id) on delete cascade;

alter table channelwright.concept_decisions
  add constraint concept_decisions_version_channel_fk
  foreign key (concept_version_id, channel_id)
  references channelwright.channel_concept_versions(id, channel_id) on delete cascade,
  add constraint concept_decisions_report_version_channel_fk
  foreign key (viability_report_id, channel_id, concept_version_id)
  references channelwright.concept_viability_reports(id, channel_id, concept_version_id) on delete restrict;

alter table channelwright.channel_strategies
  add constraint channel_strategies_version_channel_fk
  foreign key (concept_version_id, channel_id)
  references channelwright.channel_concept_versions(id, channel_id) on delete restrict;

alter table channelwright.video_projects
  add constraint video_projects_channel_owner_fk
  foreign key (channel_id, owner_id)
  references channelwright.channels(id, owner_id) on delete cascade;

alter table channelwright.workflow_runs
  add constraint workflow_runs_channel_owner_fk
  foreign key (channel_id, owner_id)
  references channelwright.channels(id, owner_id) on delete cascade,
  add constraint workflow_runs_video_owner_fk
  foreign key (video_project_id, owner_id)
  references channelwright.video_projects(id, owner_id) on delete cascade;

alter table channelwright.agent_runs
  add constraint agent_runs_workflow_owner_fk
  foreign key (workflow_run_id, owner_id)
  references channelwright.workflow_runs(id, owner_id) on delete cascade;

alter table channelwright.script_qa_reports
  add constraint script_qa_script_video_fk
  foreign key (script_version_id, video_project_id)
  references channelwright.script_versions(id, video_project_id) on delete cascade;

alter table channelwright.script_approvals
  add constraint script_approvals_script_video_fk
  foreign key (script_version_id, video_project_id)
  references channelwright.script_versions(id, video_project_id) on delete restrict;

alter table channelwright.cost_events
  add constraint cost_events_channel_owner_fk
  foreign key (channel_id, owner_id)
  references channelwright.channels(id, owner_id) on delete cascade,
  add constraint cost_events_video_owner_fk
  foreign key (video_project_id, owner_id)
  references channelwright.video_projects(id, owner_id) on delete cascade,
  add constraint cost_events_agent_owner_fk
  foreign key (agent_run_id, owner_id)
  references channelwright.agent_runs(id, owner_id) on delete set null (agent_run_id);
