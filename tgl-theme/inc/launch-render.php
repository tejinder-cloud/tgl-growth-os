<?php
/**
 * Renders one launch page: the package's header part, page body and footer part, with the package's CSS and
 * JS for that page, self-hosted fonts, and the form config. wp_head()/wp_footer() stay so plugins (Rank Math,
 * analytics, the admin bar) keep working; the block theme's own front-end styles are removed in launch.php.
 *
 * @package TGL_Theme
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$entry  = $GLOBALS['tgl_launch_entry'] ?? null;
if ( ! is_array( $entry ) ) {
	wp_die( 'Launch page entry missing.' );
}
$slug   = (string) $entry['slug'];
$base   = get_theme_file_path( 'launch' );
$assets = get_theme_file_uri( 'launch/assets' );
$fonts  = get_theme_file_uri( 'assets/fonts' );

$read = static function ( string $rel ) use ( $base ): string {
	$file = $base . '/' . $rel;
	return file_exists( $file ) ? (string) file_get_contents( $file ) : '';
};

$header = tgl_launch_fill( $read( 'parts/header.html' ), $entry );
$body   = tgl_launch_fill( $read( 'pages/' . $slug . '.html' ), $entry );
$footer = tgl_launch_fill( $read( 'parts/footer.html' ), $entry );
$config = tgl_launch_config();
?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo( 'charset' ); ?>">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<?php if ( ! current_theme_supports( 'title-tag' ) ) : // Block themes print the title in wp_head(); this is the fallback. ?>
<title><?php echo esc_html( wp_get_document_title() ); ?></title>
<?php endif; ?>
<?php if ( ! empty( $entry['description'] ) ) : ?>
<meta name="description" content="<?php echo esc_attr( (string) $entry['description'] ); ?>">
<?php endif; ?>
<link rel="preload" href="<?php echo esc_url( $fonts . '/dm-sans-latin.woff2' ); ?>" as="font" type="font/woff2" crossorigin>
<?php // Fraunces loads on demand: several pages use only the italic accent face. ?>
<style>
@font-face{font-family:"DM Sans";font-style:normal;font-weight:400 700;font-display:swap;src:url("<?php echo esc_url( $fonts . '/dm-sans-latin.woff2' ); ?>") format("woff2")}
@font-face{font-family:"Fraunces";font-style:normal;font-weight:300 700;font-display:swap;src:url("<?php echo esc_url( $fonts . '/fraunces-latin-normal.woff2' ); ?>") format("woff2")}
@font-face{font-family:"Fraunces";font-style:italic;font-weight:300 700;font-display:swap;src:url("<?php echo esc_url( $fonts . '/fraunces-latin-italic.woff2' ); ?>") format("woff2")}
</style>
<?php foreach ( (array) ( $entry['css'] ?? array( 'site.css' ) ) as $css ) : ?>
<link rel="stylesheet" href="<?php echo esc_url( $assets . '/css/' . $css . '?v=' . tgl_launch_asset_version( 'css/' . $css ) ); ?>">
<?php endforeach; ?>
<script>window.TGL=<?php echo wp_json_encode( $config ); ?>;</script>
<?php wp_head(); ?>
</head>
<body <?php body_class( 'tgl-launch tgl-launch-' . sanitize_html_class( $slug ) ); ?>>
<?php wp_body_open(); ?>
<?php
// Trusted theme files from the repository; printed as authored, with the tokens filled above.
echo $header; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
echo $body;   // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
echo $footer; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
foreach ( (array) ( $entry['js'] ?? array( 'site.js' ) ) as $js ) :
	?>
<script defer src="<?php echo esc_url( $assets . '/js/' . $js . '?v=' . tgl_launch_asset_version( 'js/' . $js ) ); ?>"></script>
	<?php
endforeach;
wp_footer();
?>
</body>
</html>
