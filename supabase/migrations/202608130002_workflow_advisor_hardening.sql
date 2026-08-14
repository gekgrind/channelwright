-- Keep new workflow policies init-plan friendly and remove indexes duplicated by unique constraints.

alter policy workflows_owner_select on channelwright.workflows
  using (owner_id = (select auth.uid()));
alter policy workflow_steps_owner_select on channelwright.workflow_steps
  using (owner_id = (select auth.uid()));
alter policy workflow_attempts_owner_select on channelwright.workflow_step_attempts
  using (owner_id = (select auth.uid()));
alter policy workflow_approvals_owner_select on channelwright.workflow_approvals
  using (owner_id = (select auth.uid()));
alter policy workflow_events_owner_select on channelwright.workflow_events
  using (owner_id = (select auth.uid()));

drop index if exists channelwright.workflow_steps_run_idx;
drop index if exists channelwright.workflow_attempts_step_idx;

