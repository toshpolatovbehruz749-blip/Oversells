/** The parts of a small IDML document, as InDesign writes them (trimmed). */
export const IDML_SAMPLE: Record<string, string> = {
  'mimetype': 'application/vnd.adobe.indesign-idml-package',
  'designmap.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<?aid style="50" type="document" readerVersion="6.0" featureSet="257" product="18.0(53)" ?>
<Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="18.0" Self="d">
  <idPkg:Graphic src="Resources/Graphic.xml" />
  <idPkg:Styles src="Resources/Styles.xml" />
  <idPkg:Preferences src="Resources/Preferences.xml" />
  <idPkg:MasterSpread src="MasterSpreads/MasterSpread_ua1.xml" />
  <idPkg:Spread src="Spreads/Spread_ub1.xml" />
  <idPkg:Story src="Stories/Story_u200.xml" />
  <idPkg:Story src="Stories/Story_u100.xml" />
</Document>`,
  'Resources/Graphic.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Graphic xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="18.0">
  <Color Self="Color/Black" Model="Process" Space="CMYK" ColorValue="0 0 0 100" Name="Black" />
  <Color Self="Color/Qizil" Model="Process" Space="CMYK" ColorValue="0 100 100 0" Name="Qizil" />
  <Color Self="Color/Moviy" Model="Process" Space="RGB" ColorValue="31 58 95" Name="Moviy" />
</idPkg:Graphic>`,
  'Resources/Styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Styles xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="18.0">
  <RootCharacterStyleGroup Self="u7b">
    <CharacterStyle Self="CharacterStyle/$ID/[No character style]" Name="$ID/[No character style]" />
    <CharacterStyle Self="CharacterStyle/Urg%e2%80%98u" Name="Urg‘u" FontStyle="Italic" FillColor="Color/Qizil" />
  </RootCharacterStyleGroup>
  <RootParagraphStyleGroup Self="u7a">
    <ParagraphStyle Self="ParagraphStyle/$ID/[No paragraph style]" Name="$ID/[No paragraph style]" />
    <ParagraphStyle Self="ParagraphStyle/$ID/NormalParagraphStyle" Name="$ID/NormalParagraphStyle" PointSize="11" />
    <ParagraphStyle Self="ParagraphStyle/Asosiy matn" Name="Asosiy matn" PointSize="10.5" FirstLineIndent="14.173" Justification="LeftJustified" SpaceAfter="0">
      <Properties><BasedOn type="object">ParagraphStyle/$ID/NormalParagraphStyle</BasedOn><Leading type="unit">14</Leading><AppliedFont type="string">Minion Pro</AppliedFont></Properties>
    </ParagraphStyle>
    <ParagraphStyle Self="ParagraphStyle/Iqtibos" Name="Iqtibos" LeftIndent="28.346" FontStyle="Italic" SpaceBefore="6" SpaceAfter="6" FillColor="Color/Moviy">
      <Properties><BasedOn type="object">ParagraphStyle/Asosiy matn</BasedOn></Properties>
    </ParagraphStyle>
    <ParagraphStyle Self="ParagraphStyle/Bob boshi" Name="Bob boshi" DropCapLines="3" DropCapCharacters="1" />
    <ParagraphGroup Self="u9" Name="Sarlavhalar">
      <ParagraphStyle Self="ParagraphStyle/Sarlavhalar%3aSarlavha 1" Name="Sarlavhalar:Sarlavha 1" PointSize="20" FontStyle="Bold" Justification="CenterAlign" SpaceAfter="18" KeepWithNext="2" />
      <ParagraphStyle Self="ParagraphStyle/Sarlavhalar%3aSarlavha 2" Name="Sarlavhalar:Sarlavha 2" PointSize="14" FontStyle="Bold" />
    </ParagraphGroup>
  </RootParagraphStyleGroup>
</idPkg:Styles>`,
  'Resources/Preferences.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Preferences xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="18.0">
  <DocumentPreference PageHeight="595.275590551" PageWidth="419.527559055" PagesPerDocument="8" FacingPages="true" />
</idPkg:Preferences>`,
  'MasterSpreads/MasterSpread_ua1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:MasterSpread xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="18.0">
  <MasterSpread Self="ua1" Name="A-Parent">
    <Page Self="ua2" Name="L"><MarginPreference ColumnCount="1" ColumnGutter="12" Top="42.52" Bottom="56.69" Left="56.69" Right="42.52" /></Page>
  </MasterSpread>
</idPkg:MasterSpread>`,
  'Spreads/Spread_ub1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Spread xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="18.0">
  <Spread Self="ub1">
    <Page Self="ub2" />
    <TextFrame Self="uf1" ParentStory="u100" />
    <Rectangle Self="ur1"><Image Self="ui1"><Link Self="ul1" LinkResourceURI="file:/Users/dizayner/Kitob/Rasmlar/tog%E2%80%98.jpg" /></Image></Rectangle>
    <TextFrame Self="uf2" ParentStory="u200" />
  </Spread>
</idPkg:Spread>`,
  'Stories/Story_u100.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Story xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="18.0">
  <Story Self="u100">
    <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Sarlavhalar%3aSarlavha 1">
      <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>Birinchi bob</Content><Br /></CharacterStyleRange>
    </ParagraphStyleRange>
    <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Bob boshi">
      <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>Qishloq tongi 50% &amp; shabada.</Content><Br /></CharacterStyleRange>
    </ParagraphStyleRange>
    <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Asosiy matn">
      <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>Oddiy matn va </Content></CharacterStyleRange>
      <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/Urg%e2%80%98u"><Content>muhim soʻz</Content></CharacterStyleRange>
      <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]" FontStyle="Bold"><Content> qalin</Content></CharacterStyleRange>
      <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>, izohi bilan</Content>
        <Footnote><ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>Izoh matni.</Content></CharacterStyleRange></ParagraphStyleRange></Footnote>
        <Content>.</Content><Br /><Content>Ikkinchi xatboshi&#x2028;yangi qatordan.</Content><Br />
      </CharacterStyleRange>
    </ParagraphStyleRange>
    <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Iqtibos">
      <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>Iqtibos matni.</Content><Br /></CharacterStyleRange>
    </ParagraphStyleRange>
    <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Asosiy matn">
      <Table Self="ut1"><Cell Name="0:0"><ParagraphStyleRange><CharacterStyleRange><Content>Katak bir</Content></CharacterStyleRange></ParagraphStyleRange></Cell><Cell Name="1:0"><ParagraphStyleRange><CharacterStyleRange><Content>Katak ikki</Content></CharacterStyleRange></ParagraphStyleRange></Cell></Table>
    </ParagraphStyleRange>
  </Story>
</idPkg:Story>`,
  'Stories/Story_u200.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Story xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="18.0">
  <Story Self="u200">
    <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Sarlavhalar%3aSarlavha 2">
      <CharacterStyleRange><Content>Ikkinchi ramka</Content></CharacterStyleRange>
    </ParagraphStyleRange>
  </Story>
</idPkg:Story>`,
};
