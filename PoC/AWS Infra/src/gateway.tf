# API Gateway HTTP API 생성
resource "aws_apigatewayv2_api" "ec2_api" {
  name          = "ec2-api"
  protocol_type = "HTTP"
}

# API Gateway Integration 설정 (HTTP_PROXY를 사용하여 EC2로 직접 연결)
resource "aws_apigatewayv2_integration" "ec2_integration" {
  api_id                 = aws_apigatewayv2_api.ec2_api.id
  integration_type       = "HTTP_PROXY"
  integration_method     = "ANY"
  integration_uri        = "http://${aws_eip.public_ec2_eip.public_ip}:80/{proxy}"
  payload_format_version = "1.0"
  timeout_milliseconds   = 30000  # 30초 타임아웃 설정 (최대값)
}

# API Gateway Route 설정 (모든 경로와 메서드에 대해 EC2로 라우팅)
resource "aws_apigatewayv2_route" "ec2_route" {
  api_id    = aws_apigatewayv2_api.ec2_api.id
  route_key = "ANY /{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.ec2_integration.id}"
}

# API Gateway Stage 설정 (자동 배포 활성화)
resource "aws_apigatewayv2_stage" "ec2_stage" {
  api_id      = aws_apigatewayv2_api.ec2_api.id
  name        = "prod"
  auto_deploy = true
}

# Root domain custom domain for API Gateway
resource "aws_apigatewayv2_domain_name" "root_domain" {
  domain_name = local.domain_name
  
  domain_name_configuration {
    certificate_arn = aws_acm_certificate.domain_cert.arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }

  depends_on = [aws_acm_certificate_validation.cert_validation]
}

# API Stage mapping to root domain
resource "aws_apigatewayv2_api_mapping" "root_mapping" {
  api_id      = aws_apigatewayv2_api.ec2_api.id
  domain_name = aws_apigatewayv2_domain_name.root_domain.id
  stage       = aws_apigatewayv2_stage.ec2_stage.id
}

# WWW subdomain custom domain for API Gateway
resource "aws_apigatewayv2_domain_name" "www_domain" {
  domain_name = "www.${local.domain_name}"
  
  domain_name_configuration {
    certificate_arn = aws_acm_certificate.domain_cert.arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }

  depends_on = [aws_acm_certificate_validation.cert_validation]
}

# API Stage mapping to www subdomain
resource "aws_apigatewayv2_api_mapping" "www_mapping" {
  api_id      = aws_apigatewayv2_api.ec2_api.id
  domain_name = aws_apigatewayv2_domain_name.www_domain.id
  stage       = aws_apigatewayv2_stage.ec2_stage.id
}
