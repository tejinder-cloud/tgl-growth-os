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
 * Enqueue scripts and styles.
 */
function tgl_theme_scripts() {
	// Core theme stylesheet
	wp_enqueue_style(
		'tgl-core-styles',
		get_template_directory_uri() . '/assets/css/tgl.css',
		array(),
		'1.0.0'
	);

	// Light tracking & client interactions (deferred, <1KB)
	wp_enqueue_script(
		'tgl-client-js',
		get_template_directory_uri() . '/assets/js/tgl.js',
		array(),
		'1.0.1',
		array(
			'strategy'  => 'defer',
			'in_footer' => true,
		)
	);
}
add_action( 'wp_enqueue_scripts', 'tgl_theme_scripts' );

/**
 * Preload hero display font in wp_head for zero CLS.
 * Only preloads the hero's display face per CWV budget.
 */
function tgl_preload_fonts() {
	$theme_uri = get_template_directory_uri();
	echo '<link rel="preload" href="' . esc_url( $theme_uri . '/assets/fonts/fraunces-latin-normal.woff2' ) . '" as="font" type="font/woff2" crossorigin>' . "\n";
	echo '<link rel="preload" href="' . esc_url( $theme_uri . '/assets/fonts/fraunces-latin-italic.woff2' ) . '" as="font" type="font/woff2" crossorigin>' . "\n";
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
}
add_action( 'init', 'tgl_disable_core_bloat' );

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

