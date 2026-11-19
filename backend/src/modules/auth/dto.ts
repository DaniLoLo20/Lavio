import { IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail() email: string;
  @IsString() @MinLength(1) password: string;
  @IsOptional() @IsString() tenantSlug?: string;
}

export class RegisterTenantDto {
  @IsString() @MinLength(2) tenantName: string;
  @Matches(/^[a-z0-9-]{3,40}$/) slug: string;
  @IsString() @MinLength(2) fullName: string;
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
}
