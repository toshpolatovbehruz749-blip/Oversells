#!/usr/bin/perl
# oversells-index: makeindex for Uzbek documents.
#
#   oversells-index [makeindex options] -o file.ind file.idx
#
# latexmk calls it instead of makeindex. When the document is Uzbek (its
# .tex loads babel's uzbek or uz-Latn/uz-Cyrl), the index is sorted by the
# Uzbek alphabets:
#   Latin:    a b d e f g h i j k l m n o p q r s t u v x y z oʻ gʻ sh ch ng ʼ
#   Cyrillic: а б в г д е ё ж з и й к л м н о п р с т у ф х ц ч ш ъ ь э ю я ў қ ғ ҳ
# with letter headings (A, B, ..., Oʻ, Gʻ, Sh, Ch). Any other document goes
# to the real makeindex unchanged.
#
# Supported \index syntax: key, sort@display, key!subkey!subsubkey,
# |encap (hyperpage, textbf, ...), |see{...}, |seealso{...}, |( and |) ranges.
use strict;
use warnings;
use utf8;
use open qw(:std :encoding(UTF-8));

my @args = @ARGV;
my ($out, $idx);
for (my $i = 0; $i < @args; $i++) {
  if ($args[$i] eq '-o') { $out = $args[++$i]; next; }
  if ($args[$i] =~ /^-[st]$/) { $i++; next; }
  next if $args[$i] =~ /^-/;
  $idx = $args[$i];
}
$idx .= '.idx' if defined $idx && !-f $idx && -f "$idx.idx";

sub uzbek_document {
  my ($idxfile) = @_;
  (my $tex = $idxfile) =~ s/\.idx$/.tex/;
  return 0 unless -f $tex;
  open(my $fh, '<', $tex) or return 0;
  local $/;
  my $text = <$fh>;
  close $fh;
  return $text =~ /uz-(Latn|Cyrl)|\{uzbek\}|uzbek[,\]]/ ? 1 : 0;
}

if (!defined $idx || !uzbek_document($idx)) {
  exec('makeindex', @args) or die "oversells-index: cannot run makeindex: $!\n";
}
$out //= ($idx =~ s/\.idx$/.ind/r);

# --- Uzbek collation ------------------------------------------------------------------
my @latin = (qw(a b d e f g h i j k l m n o p q r s t u v x y z), "o\x{2bb}", "g\x{2bb}", 'sh', 'ch', 'ng', "\x{2bc}");
my @cyrillic = split //, "абвгдеёжзийклмнопрстуфхцчшъьэюяўқғҳ";
my %rank;
my $r = 100;
$rank{$_} = $r++ for @latin;
$r = 200;
$rank{$_} = $r++ for @cyrillic;

# Letters of a key: multi-letter Uzbek letters first, typed apostrophes accepted.
sub letters {
  my ($s) = @_;
  $s = lc $s;
  $s =~ s/\\(foreignlanguage|selectlanguage)\s*\{[^{}]*\}//g;   # language names are not text
  $s =~ s/\\[A-Za-z@]+\*?\s*//g;      # LaTeX commands
  $s =~ s/[{}\$]//g;
  $s =~ s/([og])['\x{2018}\x{2019}`\x{2bc}\x{2bb}]/$1\x{2bb}/g;
  $s =~ s/['\x{2018}\x{2019}`]/\x{2bc}/g;
  my @out;
  while (length $s) {
    if ($s =~ s/^(o\x{2bb}|g\x{2bb}|sh|ch|ng)//) { push @out, $1; next; }
    $s =~ s/^(.)//s;
    push @out, $1;
  }
  return @out;
}

sub sortkey {
  my ($s) = @_;
  return join('', map {
    my $l = $_;
    exists $rank{$l} ? chr(0x1000 + $rank{$l}) : $l =~ /\p{L}/ ? chr(0x2000 + ord($l)) : $l =~ /\d/ ? chr(0x500 + ord($l)) : '';
  } letters($s)) . "\x{1}" . lc $s;
}

sub heading {
  my ($s) = @_;
  my ($first) = letters($s);
  return 'Raqamlar' if !defined $first || $first =~ /\d/;
  return '' unless $first =~ /\p{L}/;
  return ucfirst $first;
}

# --- read the .idx ---------------------------------------------------------------------
open(my $in, '<', $idx) or die "oversells-index: cannot read $idx: $!\n";
my %entries;    # path (key parts joined by \0) -> { display => [...], pages => [...] }
while (my $line = <$in>) {
  next unless $line =~ /^\\indexentry\{(.*)\}\{([^{}]*)\}\s*$/;
  my ($entry, $page) = ($1, $2);
  my $encap = '';
  # Split off |encap at depth 0.
  my ($depth, $pos) = (0, -1);
  for (my $i = 0; $i < length $entry; $i++) {
    my $c = substr($entry, $i, 1);
    if ($c eq '\\') { $i++; next; }
    $depth++ if $c eq '{';
    $depth-- if $c eq '}';
    if ($c eq '|' && $depth == 0) { $pos = $i; last; }
  }
  if ($pos >= 0) { $encap = substr($entry, $pos + 1); $entry = substr($entry, 0, $pos); }
  my @levels = split /!/, $entry;
  my (@sort, @shown);
  for my $level (@levels) {
    my ($sort, $shown) = $level =~ /^(.*?)@(.*)$/ ? ($1, $2) : ($level, $level);
    push @sort, $sort;
    push @shown, $shown;
  }
  my $path = join("\0", map { sortkey($_) } @sort);
  my $e = $entries{$path} //= { sort => [@sort], shown => [@shown], pages => [] };
  push @{ $e->{pages} }, { page => $page, encap => $encap };
}
close $in;

sub page_value {
  my ($p) = @_;
  return (0, $p) if $p =~ /^\d+$/;
  my %rv = (i => 1, v => 5, x => 10, l => 50, c => 100, d => 500, m => 1000);
  if ($p =~ /^[ivxlcdm]+$/i) {
    my ($n, $prev) = (0, 0);
    for my $ch (reverse split //, lc $p) { my $v = $rv{$ch}; $n += $v < $prev ? -$v : $v; $prev = $v; }
    return (-1, $n);
  }
  return (1, 0);
}

sub wrap {
  my ($encap, $page) = @_;
  return $page if $encap eq '' || $encap eq '(' || $encap eq ')';
  (my $cmd = $encap) =~ s/^[()]//;
  return $page if $cmd eq '';
  return "\\$cmd\{$page\}" if $cmd =~ /^[A-Za-z]+$/;
  return "\\$cmd\{$page\}" if $cmd =~ /^(see|seealso)\{/;    # \see{x}{page}
  return $page;
}

sub pages_text {
  my ($pages) = @_;
  my @sorted = sort {
    my @a = page_value($a->{page});
    my @b = page_value($b->{page});
    $a[0] <=> $b[0] || $a[1] <=> $b[1]
  } @$pages;
  my (@parts, %seen, $open);
  for my $p (@sorted) {
    my $enc = $p->{encap};
    if ($enc =~ /^\(/) { $open = wrap($enc, $p->{page}); next; }
    if ($enc =~ /^\)/) {
      push @parts, defined $open ? "$open--" . wrap($enc, $p->{page}) : wrap($enc, $p->{page});
      undef $open;
      next;
    }
    my $text = wrap($enc, $p->{page});
    next if $seen{$text}++;
    push @parts, $text;
  }
  push @parts, $open if defined $open;
  return join(', ', @parts);
}

# --- write the .ind --------------------------------------------------------------------
open(my $fh, '>', $out) or die "oversells-index: cannot write $out: $!\n";
print $fh "\\begin{theindex}\n";
my $group = undef;
my @previous = ();
for my $path (sort keys %entries) {
  my $e = $entries{$path};
  my $h = heading($e->{sort}[0]);
  if (!defined $group || $h ne $group) {
    print $fh "\n  \\indexspace\n" if defined $group;
    print $fh "\n  {\\bfseries\\large $h}\\par\\nopagebreak\n" if $h ne '';
    $group = $h;
    @previous = ();
  }
  my @levels = @{ $e->{shown} };
  # Print the parent levels that this entry introduces (an entry only with subentries).
  for my $l (0 .. $#levels) {
    my $same = defined $previous[$l] && $previous[$l] eq $levels[$l];
    next if $same && $l < $#levels;
    my $cmd = ('\\item', '\\subitem', '\\subsubitem')[$l > 2 ? 2 : $l];
    my $indent = '  ' x ($l + 1);
    print $fh "$indent$cmd $levels[$l]" . ($l == $#levels ? ', ' . pages_text($e->{pages}) : '') . "\n";
  }
  @previous = @levels;
}
print $fh "\n\\end{theindex}\n";
close $fh;
(my $ilg = $out) =~ s/\.ind$/.ilg/;
if (open(my $log, '>', $ilg)) { print $log "oversells-index: Uzbek alphabetical order, " . scalar(keys %entries) . " entries.\n"; close $log; }
exit 0;
