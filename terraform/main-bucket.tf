terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# ---------------------------------------------------------------------------------------------------------------------
# DATA SOURCES
# ---------------------------------------------------------------------------------------------------------------------

# Obtém dinamicamente dados da conta AWS e do executor atual do Terraform
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# ---------------------------------------------------------------------------------------------------------------------
# PROVIDER
# ---------------------------------------------------------------------------------------------------------------------

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Environment = var.environment
      ManagedBy   = "Terraform"
      Project     = "Infraestrutura"
    }
  }
}

# ---------------------------------------------------------------------------------------------------------------------
# VARIÁVEIS COM VALIDAÇÕES
# ---------------------------------------------------------------------------------------------------------------------

variable "aws_region" {
  description = "Região da AWS onde o bucket será criado"
  type        = string
  default     = "us-east-1"
}

variable "bucket_name" {
  description = "Nome do bucket S3. Deve ser globalmente único e seguir as regras DNS da AWS."
  type        = string
  default     = "meu-bucket-s3"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.bucket_name))
    error_message = "O nome do bucket deve ter entre 3 e 63 caracteres, conter apenas letras minúsculas, números, pontos ou hífens, e começar/terminar com letra ou número."
  }
}

variable "environment" {
  description = "Ambiente de deploy"
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "O ambiente deve ser 'dev', 'staging' ou 'prod'."
  }
}

variable "allowed_iam_user_arn" {
  description = "ARN do usuário IAM autorizado com exclusividade a operar no bucket (ex: arn:aws:iam::123456789012:user/usuario)"
  type        = string
  default     = "arn:aws:iam::123456789012:user/usuario-iam-autorizado"

  validation {
    condition     = can(regex("^arn:aws:iam::[0-9]{12}:(user|role)/.+", var.allowed_iam_user_arn))
    error_message = "O ARN informado deve ser um ARN válido de usuário ou role do AWS IAM."
  }
}

variable "noncurrent_version_expiration_days" {
  description = "Dias para expirar versões antigas de objetos (FinOps / controle de custos)"
  type        = number
  default     = 90
}

# ---------------------------------------------------------------------------------------------------------------------
# RECURSOS DO S3 (BOAS PRÁTICAS CIS BENCHMARK & FINOPS)
# ---------------------------------------------------------------------------------------------------------------------

# 1. Bucket S3 Principal
resource "aws_s3_bucket" "this" {
  bucket        = var.bucket_name
  force_destroy = true

  tags = {
    Name = var.bucket_name
  }
}

# 2. Desativação de ACLs legadas em favor de IAM policies (Padrão moderno AWS)
resource "aws_s3_bucket_ownership_controls" "this" {
  bucket = aws_s3_bucket.this.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# 3. Bloqueio total de acesso público (CIS AWS Benchmark)
resource "aws_s3_bucket_public_access_block" "this" {
  bucket = aws_s3_bucket.this.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# 4. Versionamento de objetos para proteção contra exclusão acidental e auditoria
resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.this.id

  versioning_configuration {
    status = "Enabled"
  }
}

# 5. Criptografia padrão em repouso (SSE-S3 com Bucket Key ativada para redução de custos)
resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

# 6. Gerenciamento de ciclo de vida (FinOps: limpa multipart uploads abortados e versões antigas)
resource "aws_s3_bucket_lifecycle_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  rule {
    id     = "clean-incomplete-and-old-versions"
    status = "Enabled"

    # Cancela uploads incompletos após 7 dias para evitar cobrança desnecessária
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }

    # Remove versões não-atuais após o período estipulado
    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_expiration_days
    }
  }

  depends_on = [aws_s3_bucket_versioning.this]
}

# 7. Configuração de CORS (Obrigatória para uploads e downloads diretos via navegador/Presigned URL)
resource "aws_s3_bucket_cors_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "POST", "HEAD", "DELETE"]
    allowed_origins = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }
}

# ---------------------------------------------------------------------------------------------------------------------
# POLÍTICA DE SEGURANÇA DO BUCKET (IAM & TLS MANDATÓRIO)
# ---------------------------------------------------------------------------------------------------------------------

data "aws_iam_policy_document" "bucket_policy" {
  # Regra 1: Obrigatória em conformidade - Exige HTTPS/TLS para todas as operações
  statement {
    sid    = "EnforceTLSRequestsOnly"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]

    resources = [
      aws_s3_bucket.this.arn,
      "${aws_s3_bucket.this.arn}/*"
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  # Regra 2: Concede acesso total ao usuário IAM autorizado
  statement {
    sid    = "AllowAuthorizedUserOnly"
    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = [var.allowed_iam_user_arn]
    }

    actions = ["s3:*"]

    resources = [
      aws_s3_bucket.this.arn,
      "${aws_s3_bucket.this.arn}/*"
    ]
  }

  # Regra 3: Nega acesso a qualquer outro principal (preserva conta root e o executor do Terraform para evitar lock-out)
  statement {
    sid    = "DenyAllOtherPrincipals"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]

    resources = [
      aws_s3_bucket.this.arn,
      "${aws_s3_bucket.this.arn}/*"
    ]

    condition {
      test     = "ArnNotEquals"
      variable = "aws:PrincipalArn"
      values = distinct(compact([
        var.allowed_iam_user_arn,
        "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root",
        data.aws_caller_identity.current.arn
      ]))
    }
  }
}

resource "aws_s3_bucket_policy" "this" {
  bucket = aws_s3_bucket.this.id
  policy = data.aws_iam_policy_document.bucket_policy.json

  depends_on = [
    aws_s3_bucket_public_access_block.this,
    aws_s3_bucket_ownership_controls.this
  ]
}

# ---------------------------------------------------------------------------------------------------------------------
# OUTPUTS
# ---------------------------------------------------------------------------------------------------------------------

output "bucket_id" {
  description = "Nome / ID do bucket criado"
  value       = aws_s3_bucket.this.id
}

output "bucket_arn" {
  description = "ARN do bucket criado"
  value       = aws_s3_bucket.this.arn
}

output "bucket_region" {
  description = "Região onde o bucket foi provisionado"
  value       = aws_s3_bucket.this.region
}
