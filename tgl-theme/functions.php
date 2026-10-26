<?php
/**
 * TGL Theme Functions and Definitions
 *
 * @package TGL_Theme
 * @since 1.0.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

/**
 * Setup theme support.
 */
function tgl_theme_setup() {
	// Add support for block styles, responsive embeds, and editor styles.
	add_theme_support( 'wp-block-styles' );
	add_theme_support( 'responsive-embeds' );
	add_theme_support( 'editor-styles' );
	add_editor_style( 'assets/css/tgl.css' );

	// Register pattern categories
	register_block_pattern_category(
		'tgl-hero',
		array( 'label' => __( 'TGL Heroes', 'tgl-theme' ) )
	);

	register_block_pattern_category(
		'tgl-sections',
		array( 'label' => __( 'TGL Sections', 'tgl-theme' ) )
	);

	register_block_pattern_category(
		'tgl-proof',
		array( 'label' => __( 'TGL Proof & Case Studies', 'tgl-theme' ) )
	);
}
add_action( 'after_setup_theme', 'tgl_theme_setup' );

/**
 * Asset version: file modification time, so assets can be cached long-term
 * by browsers/CDN and still bust automatically when the file changes.
 */
function tgl_asset_version( $relative_path, $fallback = '1.0.0' ) {
	$file = get_template_directory() . $relative_path;
	return file_exists( $file ) ? (string) filemtime( $file ) : $fallback;
}

/**
 * Enqueue scripts and styles.
 */
function tgl_theme_scripts() {
	// Core theme stylesheet
	wp_enqueue_style(
		'tgl-core-styles',
		get_template_directory_uri() . '/assets/css/tgl.css',
		array(),
		tgl_asset_version( '/assets/css/tgl.css', '1.0.0' )
	);

	// Below-the-fold rendering hints, inlined (no extra request).
	// content-visibility:auto lets the browser skip layout/paint of sections
	// until they approach the viewport. Anchor links and IntersectionObserver
	// continue to work. contain-intrinsic-size "auto" remembers real height
	// once rendered, so scrollbar/CLS stay stable.
	wp_add_inline_style(
		'tgl-core-styles',
		'.tgl-section--thinking,.tgl-section--running,.tgl-cta-band,.tgl-site-footer{content-visibility:auto;contain-intrinsic-size:auto 900px;}'
		. '.tgl-site-footer{contain-intrinsic-size:auto 400px;}'
		. '@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto;}}'
	);

	// Light tracking & client interactions (deferred, <1KB)
	wp_enqueue_script(
		'tgl-client-js',
		get_template_directory_uri() . '/assets/js/tgl.js',
		array(),
		tgl_asset_version( '/assets/js/tgl.js', '1.0.1' ),
		array(
			'strategy'  => 'defer',
			'in_footer' => true,
		)
	);
}
add_action( 'wp_enqueue_scripts', 'tgl_theme_scripts' );

/**
 * Only load CSS for core blocks that are actually on the page.
 */
add_filter( 'should_load_separate_core_block_assets', '__return_true' );

/**
 * Preload the fonts used above the fold (display normal + italic accent word,
 * and the body face) for zero CLS. Fonts use font-display: optional, so a
 * preload is what lets them render on first paint.
 */
function tgl_preload_fonts() {
	$theme_uri = get_template_directory_uri();
	$fonts     = array(
		'fraunces-latin-normal.woff2',
		'fraunces-latin-italic.woff2',
		'dm-sans-latin.woff2',
	);
	foreach ( $fonts as $font ) {
		echo '<link rel="preload" href="' . esc_url( $theme_uri . '/assets/fonts/' . $font ) . '" as="font" type="font/woff2" crossorigin>' . "\n";
	}
}
add_action( 'wp_head', 'tgl_preload_fonts', 1 );

/**
 * Disable WordPress core bloat for performance.
 */
function tgl_disable_core_bloat() {
	// Disable emojis
	remove_action( 'wp_head', 'print_emoji_detection_script', 7 );
	remove_action( 'admin_print_scripts', 'print_emoji_detection_script' );
	remove_action( 'wp_print_styles', 'print_emoji_styles' );
	remove_action( 'admin_print_styles', 'print_emoji_styles' );
	remove_filter( 'the_content_feed', 'wp_staticize_emoji' );
	remove_filter( 'comment_text_rss', 'wp_staticize_emoji' );
	remove_filter( 'wp_mail', 'wp_staticize_emoji_for_email' );

	// Remove RSD, wlwmanifest, shortlink, generator
	remove_action( 'wp_head', 'rsd_link' );
	remove_action( 'wp_head', 'wlwmanifest_link' );
	remove_action( 'wp_head', 'wp_shortlink_wp_head' );
	remove_action( 'wp_head', 'wp_generator' );

	// Remove oEmbed discovery links and REST/oEmbed head links (unused on the front end).
	remove_action( 'wp_head', 'wp_oembed_add_discovery_links' );
	remove_action( 'wp_head', 'wp_oembed_add_host_js' );
	remove_action( 'wp_head', 'rest_output_link_wp_head' );
	remove_action( 'template_redirect', 'rest_output_link_header', 11 );

	// Duotone SVG filter markup injected into <body>; this theme defines no duotone.
	remove_action( 'wp_body_open', 'wp_global_styles_render_svg_filters' );
	remove_action( 'in_admin_header', 'wp_global_styles_render_svg_filters' );
}
add_action( 'init', 'tgl_disable_core_bloat' );

/**
 * Front-end only: drop wp-embed.js and jQuery Migrate (nothing in the theme uses them).
 */
function tgl_dequeue_frontend_scripts() {
	wp_dequeue_script( 'wp-embed' );
}
add_action( 'wp_footer', 'tgl_dequeue_frontend_scripts' );

function tgl_remove_jquery_migrate( $scripts ) {
	if ( ! is_admin() && isset( $scripts->registered['jquery'] ) ) {
		$jquery = $scripts->registered['jquery'];
		if ( ! empty( $jquery->deps ) ) {
			$jquery->deps = array_diff( $jquery->deps, array( 'jquery-migrate' ) );
		}
	}
}
add_action( 'wp_default_scripts', 'tgl_remove_jquery_migrate' );

/**
 * Speculation Rules: prefetch internal links on hover/pointer-down so
 * page-to-page navigation feels instant. Skipped when WordPress core (6.8+)
 * already prints its own rules, and for admin/login/query-string URLs.
 */
function tgl_speculation_rules() {
	if ( is_admin() || is_user_logged_in() || function_exists( 'wp_get_speculation_rules' ) ) {
		return;
	}
	$rules = array(
		'prefetch' => array(
			array(
				'where'     => array(
					'and' => array(
						array( 'href_matches' => '/*' ),
						array( 'not' => array( 'href_matches' => '/wp-*.php' ) ),
						array( 'not' => array( 'href_matches' => '/wp-admin/*' ) ),
						array( 'not' => array( 'href_matches' => '/*\\?*' ) ),
						array( 'not' => array( 'selector_matches' => '[rel~=nofollow]' ) ),
					),
				),
				'eagerness' => 'moderate',
			),
		),
	);
	echo '<script type="speculationrules">' . wp_json_encode( $rules ) . '</script>' . "\n";
}
add_action( 'wp_footer', 'tgl_speculation_rules', 20 );

/**
 * Rank Math 301 Redirect: /growth-roadmap → /roadmap (and /growth-roadmap/* → /roadmap)
 */
function tgl_register_rank_math_redirects() {
	// Programmatically register redirect in Rank Math's DB if available
	if ( class_exists( '\\RankMath\\Redirections\\DB' ) ) {
		global $wpdb;
		$table = $wpdb->prefix . 'rank_math_redirections';
		if ( $wpdb->get_var( "SHOW TABLES LIKE '$table'" ) === $table ) {
			$exists = $wpdb->get_var( $wpdb->prepare(
				"SELECT id FROM {$table} WHERE url_to = %s LIMIT 1",
				'/roadmap'
			) );
			if ( ! $exists ) {
				\RankMath\Redirections\DB::add( array(
					'url_to'      => '/roadmap',
					'header_code' => 301,
					'status'      => 'active',
					'sources'     => array(
						array(
							'pattern'    => 'growth-roadmap',
							'comparison' => 'exact',
						),
						array(
							'pattern'    => '^growth-roadmap/(.*)',
							'comparison' => 'regex',
						),
					),
				) );
			}
		}
	}
}
add_action( 'init', 'tgl_register_rank_math_redirects' );

/**
 * Fallback 301 redirect for /growth-roadmap to /roadmap
 */
function tgl_growth_roadmap_fallback_redirect() {
	if ( ! empty( $_SERVER['REQUEST_URI'] ) ) {
		$path = parse_url( $_SERVER['REQUEST_URI'], PHP_URL_PATH );
		if ( preg_match( '#^/growth-roadmap(/.*)?$#i', $path ) ) {
			$query = ! empty( $_SERVER['QUERY_STRING'] ) ? '?' . $_SERVER['QUERY_STRING'] : '';
			wp_redirect( home_url( '/roadmap' . $query ), 301 );
			exit;
		}
	}
}
add_action( 'template_redirect', 'tgl_growth_roadmap_fallback_redirect', 1 );
