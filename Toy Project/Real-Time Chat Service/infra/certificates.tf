# TLS/HTTPS using Let's Encrypt certificates generated on instance
# Let's Encrypt certificate resource (only when enabled)
resource "oci_load_balancer_certificate" "lb_cert_letsencrypt" {
  count = var.use_letsencrypt ? 1 : 0

  load_balancer_id = oci_load_balancer_load_balancer.chat_lb.id
  certificate_name = "letsencrypt-junhyung-xyz"

  # Certificates are managed via update script
  public_certificate = var.letsencrypt_cert_content
  private_key        = var.letsencrypt_key_content
  ca_certificate     = var.letsencrypt_chain_content != "" ? var.letsencrypt_chain_content : null

  # Allow certificate content updates via variables
  lifecycle {
    ignore_changes = [
      public_certificate,
      private_key,
      ca_certificate
    ]
  }
}

# HTTPS listener (only when Let's Encrypt is enabled)
resource "oci_load_balancer_listener" "chat_https_listener_letsencrypt" {
  count = var.use_letsencrypt ? 1 : 0

  load_balancer_id         = oci_load_balancer_load_balancer.chat_lb.id
  name                     = "https"
  default_backend_set_name = oci_load_balancer_backend_set.chat_bs.name
  protocol                 = "HTTP"
  port                     = 443

  ssl_configuration {
    certificate_name        = oci_load_balancer_certificate.lb_cert_letsencrypt[0].certificate_name
    verify_peer_certificate = false
    protocols               = ["TLSv1.2", "TLSv1.3"]
    cipher_suite_name       = "oci-compatible-ssl-cipher-suite-v1"
    server_order_preference = "ENABLED"
  }
}

# HTTP -> HTTPS redirect (only when HTTPS is enabled)
resource "oci_load_balancer_rule_set" "redirect_to_https" {
  count = var.use_letsencrypt ? 1 : 0

  load_balancer_id = oci_load_balancer_load_balancer.chat_lb.id
  name             = "redirect_to_https"
  items {
    action = "REDIRECT"
    conditions {
      attribute_name  = "PATH"
      operator        = "PREFIX_MATCH"
      attribute_value = "/"
    }
    response_code = 301
    redirect_uri {
      protocol = "HTTPS"
      port     = 443
    }
  }
}

# HTTP listener with redirect (when HTTPS enabled) or direct backend (when HTTPS disabled)
resource "oci_load_balancer_listener" "chat_http_listener" {
  load_balancer_id         = oci_load_balancer_load_balancer.chat_lb.id
  name                     = "http"
  default_backend_set_name = oci_load_balancer_backend_set.chat_bs.name
  protocol                 = "HTTP"
  port                     = 80
  rule_set_names           = var.use_letsencrypt ? [oci_load_balancer_rule_set.redirect_to_https[0].name] : []
}

# Debug listener (temporary)
resource "oci_load_balancer_listener" "debug_http_8080" {
  load_balancer_id         = oci_load_balancer_load_balancer.chat_lb.id
  name                     = "debug-8080"
  default_backend_set_name = oci_load_balancer_backend_set.chat_bs.name
  protocol                 = "HTTP"
  port                     = 8080
}
