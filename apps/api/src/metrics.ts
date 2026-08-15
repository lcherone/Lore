export class ApiMetrics {
  requests = 0;
  taskPreparations = 0;
  verifications = 0;
  webhookDeliveries = 0;
  webhookReplays = 0;
  failures = 0;

  render(): string {
    return [
      "# TYPE lore_http_requests_total counter",
      `lore_http_requests_total ${this.requests}`,
      "# TYPE lore_task_preparations_total counter",
      `lore_task_preparations_total ${this.taskPreparations}`,
      "# TYPE lore_change_verifications_total counter",
      `lore_change_verifications_total ${this.verifications}`,
      "# TYPE lore_github_webhook_deliveries_total counter",
      `lore_github_webhook_deliveries_total ${this.webhookDeliveries}`,
      "# TYPE lore_github_webhook_replays_total counter",
      `lore_github_webhook_replays_total ${this.webhookReplays}`,
      "# TYPE lore_failures_total counter",
      `lore_failures_total ${this.failures}`,
      ""
    ].join("\n");
  }
}

