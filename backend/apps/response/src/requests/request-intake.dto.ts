import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class RequestLocationDto {
  @IsString() @IsIn(['Point'])
  type!: 'Point';

  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(2) @IsNumber({}, { each: true })
  coordinates!: [number, number];

  @IsString() @IsIn(['GPS', 'MANUAL_PIN'])
  source!: 'GPS' | 'MANUAL_PIN';

  @IsOptional() @IsNumber()
  declare accuracy_m?: number | null;

  @IsOptional() @IsDateString()
  captured_at?: string | null;
}

export class CreateSelfRequestDto {
  @IsString() @Matches(/^[A-Z0-9_]{2,40}$/)
  incident_category_code!: string;

  @IsOptional() @IsString() @MaxLength(2000)
  description?: string | null;

  @IsOptional() @IsInt() @Min(1) @Max(10000)
  people_affected?: number | null;

  @IsOptional() @IsInt() @Min(0) @Max(10000)
  children_count?: number | null;

  @IsOptional() @IsInt() @Min(0) @Max(10000)
  elderly_count?: number | null;

  @IsOptional() @IsString() @MaxLength(200) @Matches(/\S/u)
  reporter_name?: string | null;

  @IsOptional() @IsString() @MaxLength(32) @Matches(/^[+0-9 ()-]+$/)
  reporter_contact_phone?: string | null;

  @IsOptional() @IsBoolean()
  reporter_declared_danger?: boolean;

  @IsOptional() @IsBoolean()
  needs_rescue?: boolean;

  @IsOptional() @IsBoolean()
  needs_relief_supplies?: boolean;

  @IsObject() @ValidateNested() @Type(() => RequestLocationDto)
  location!: RequestLocationDto;
}

export class AlternateContactDto {
  @IsString() @MaxLength(200) @Matches(/\S/u)
  name!: string;

  @IsOptional() @IsString() @MaxLength(32) @Matches(/^[+0-9 ()-]+$/)
  phone?: string | null;
}

export class CreateProxyRequestDto extends CreateSelfRequestDto {
  @IsString() @MaxLength(100) @Matches(/\S/u)
  relationship!: string;

  @IsOptional() @IsString() @MaxLength(32) @Matches(/^[+0-9 ()-]+$/)
  beneficiary_contact_phone?: string | null;

  @IsOptional() @IsObject() @ValidateNested() @Type(() => AlternateContactDto)
  alternate_contact?: AlternateContactDto | null;

  @IsString() @MaxLength(500) @Matches(/\S/u)
  information_source!: string;

  @IsDateString({ strict: true, strictSeparator: true }) @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/)
  last_known_situation_at!: string;

  @IsString() @IsIn(['REACHABLE', 'UNREACHABLE', 'UNKNOWN'])
  contactability!: 'REACHABLE' | 'UNREACHABLE' | 'UNKNOWN';
}
