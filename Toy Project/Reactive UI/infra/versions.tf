terraform {
  required_version = ">= 1.12"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 9.14"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.29"
    }
  }

  # State lives in OCI Object Storage (bucket created by ./bootstrap).
  # Backend settings are kept out of git: copy backend.hcl.example to backend.hcl, then
  #   terraform init -backend-config=backend.hcl
  # Auth comes from the profile in ~/.oci/config.
  backend "oci" {}
}
