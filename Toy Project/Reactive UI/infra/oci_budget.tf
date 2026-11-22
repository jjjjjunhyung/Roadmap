# A cost alarm for the OCI tenancy. It is an upgraded (pay-as-you-go) account: everything here fits
# Always Free, but anything beyond it would be billed without asking. The budget is 1 in the
# tenancy's currency (SGD) a month; any actual cost at all (1% of it) or a forecast over it mails
# budget_email. Budgets and their alerts are free.
resource "oci_budget_budget" "monthly" {
  compartment_id         = var.tenancy_ocid
  display_name           = "${local.name_prefix}-monthly"
  description            = "Any cost means something left Always Free"
  amount                 = 1
  reset_period           = "MONTHLY"
  processing_period_type = "MONTH"
  target_type            = "COMPARTMENT"
  targets                = [var.tenancy_ocid]
  freeform_tags          = local.common_tags
}

resource "oci_budget_alert_rule" "any_cost" {
  budget_id      = oci_budget_budget.monthly.id
  display_name   = "any-actual-cost"
  description    = "Actual spend reached 1% of the budget: something is no longer free"
  type           = "ACTUAL"
  threshold      = 1
  threshold_type = "PERCENTAGE"
  recipients     = var.budget_email
  message        = "OCI (reactive-ui): a charge has appeared this month. Check Cost Analysis for what left Always Free."
}

resource "oci_budget_alert_rule" "forecast" {
  budget_id      = oci_budget_budget.monthly.id
  display_name   = "forecast-over-budget"
  description    = "Forecast spend goes past the budget"
  type           = "FORECAST"
  threshold      = 100
  threshold_type = "PERCENTAGE"
  recipients     = var.budget_email
  message        = "OCI (reactive-ui): this month's forecast is past the budget. Check Cost Analysis."
}
