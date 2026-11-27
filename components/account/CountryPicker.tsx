'use client';

import { Combobox } from '@base-ui/react/combobox';
import { Check, ChevronsUpDown, Globe, Search } from 'lucide-react';
import Image from 'next/image';
import { matchesCountry, type CountryOption } from '@/lib/country-names';

function CountryFlag({ iso }: { iso?: string }) {
  if (iso?.length !== 2) return <Globe aria-hidden="true" size={20} />;
  return <Image alt="" className="wc-country__flag" height={16} src={`/country-flags/${iso}.svg`} unoptimized width={24} />;
}

export function CountryPicker({ id, name, options, value, onChange, errorId }: {
  id: string;
  name: 'residenceCountry' | 'phoneCountry';
  options: readonly CountryOption[];
  value: string;
  onChange: (iso: string) => void;
  errorId?: string;
}) {
  const phone = name === 'phoneCountry';
  const label = phone ? '전화 국가번호' : '거주 국가·지역';
  const selected = options.find(country => country.iso === value) ?? null;
  const display = phone ? (selected?.dial ? `+${selected.dial}` : '직접 입력') : selected?.label ?? '국가·지역 선택';
  const selection = <><CountryFlag iso={selected?.iso} /><span>{display}</span></>;

  if (phone && options.length === 1 && selected) {
    return (
      <span className="wc-country__fixed">
        <span className="wc-sr-only">전화 국가번호 {selected.label}</span>{selection}
        <input name={name} type="hidden" value={selected.iso} />
      </span>
    );
  }

  return (
    <Combobox.Root
      autoHighlight
      filter={matchesCountry}
      items={options}
      itemToStringLabel={country => country.label}
      itemToStringValue={country => country.iso}
      name={name}
      onValueChange={country => onChange(country?.iso ?? '')}
      value={selected}
    >
      <Combobox.Trigger
        aria-describedby={errorId}
        aria-invalid={errorId ? true : undefined}
        aria-label={[label, selected?.label, selected?.dial && `+${selected.dial}`].filter(Boolean).join(' ')}
        aria-required={!phone || undefined}
        className="wc-country__trigger"
        id={id}
        type="button"
      >
        {selection}
        <ChevronsUpDown aria-hidden="true" size={16} />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner align="start" className="wc-root wc-country__positioner" sideOffset={4}>
          <Combobox.Popup aria-label={label} className="wc-country__popup">
            <div className="wc-country__search">
              <Search aria-hidden="true" size={18} />
              <Combobox.Input aria-label="국가 검색" className="wc-country__input" placeholder={phone ? '국가명 또는 국가번호 검색' : '국가명 또는 국가 코드 검색'} />
            </div>
            <Combobox.Empty className="wc-country__empty">검색 결과가 없어요.</Combobox.Empty>
            <Combobox.List aria-label={label} className="wc-country__list">
              {(country: CountryOption) => (
                <Combobox.Item className="wc-country__option" key={country.iso} value={country}>
                  <CountryFlag iso={country.iso} />
                  <span className="wc-country__name">{country.label}</span>
                  <Combobox.ItemIndicator><Check aria-hidden="true" size={16} /></Combobox.ItemIndicator>
                  {country.dial && <span className="wc-country__dial">+{country.dial}</span>}
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
