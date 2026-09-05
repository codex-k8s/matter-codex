-- name: revision_impact__search_items :many
SELECT item.ref
FROM control_plane.revision_impact_items item
JOIN control_plane.revision_impact_plans plan ON plan.id=item.plan_id
JOIN control_plane.agents agent ON agent.organization_id=plan.organization_id AND agent.ref=item.snapshot->>'ConsumerRef'
JOIN control_plane.projects project ON project.id=agent.project_id AND project.organization_id=plan.organization_id
WHERE item.plan_id=@plan_id::uuid AND plan.kind='RUNTIME_ENVIRONMENT'
 AND strpos(lower(agent.name||' '||agent.ref||' '||project.name||' '||project.ref||' '||COALESCE(item.snapshot->>'BindingRef','')),lower(@query))>0
ORDER BY item.ref;
