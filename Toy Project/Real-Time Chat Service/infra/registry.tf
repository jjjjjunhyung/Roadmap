# Container Registry for application images
resource "oci_artifacts_container_repository" "chat_repo" {
  compartment_id = var.compartment_ocid
  display_name   = "${local.name_prefix}-app"
  is_immutable   = false
  is_public      = false

  readme {
    content = "Container repository for ${var.project_name} application"
    format  = "text/markdown"
  }

  freeform_tags = merge(local.storage_tags, {
    Type = "container-registry"
  })
}
